// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Aspects,
  Aws,
  CfnCondition,
  CfnMapping,
  CfnOutput,
  CfnParameter,
  CfnResource,
  CfnRule,
  Fn,
  IAspect,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct, IConstruct } from "constructs";
import { DLTAPI } from "./front-end/api";
import { CognitoAuthConstruct } from "./front-end/auth";
import { CommonResources } from "./common-resources/common-resources";
import { DLTConsoleConstruct } from "./front-end/console";
import { CustomResourcesConstruct } from "./common-resources/custom-resources";
import { ECSResourcesConstruct } from "./testing-resources/ecs";
import { ScenarioTestRunnerStorageConstruct } from "./back-end/scenarios-storage";
import { TaskRunnerStepFunctionConstruct } from "./back-end/step-functions";
import { TestRunnerLambdasConstruct } from "./back-end/test-task-lambdas";
import { FargateVpcConstruct } from "./testing-resources/vpc";
import { RealTimeDataConstruct } from "./testing-resources/real-time-data";
import { SolutionsMetrics } from "../../metrics-utils";
import { Solution } from "../bin/solution";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { CidrBlockCfnParameters } from "./common-resources/common-cfn-parameters";

/**
 * CDK Aspect implementation to set up conditions to the entire Construct resources
 */
class ConditionAspect implements IAspect {
  private readonly condition: CfnCondition;

  constructor(condition: CfnCondition) {
    this.condition = condition;
  }

  /**
   * Implement IAspect.visit to set the condition to whole resources in Construct.
   *
   * @param {IConstruct} node Construct node to visit
   */
  visit(node: IConstruct): void {
    const resource = node as CfnResource;
    if (resource.cfnOptions) {
      resource.cfnOptions.condition = this.condition;
    }
  }
}

/**
 * DLTStack props
 *
 * @interface DLTStackProps
 */
export interface DLTStackProps extends StackProps {
  readonly solution: Solution;
  readonly stackType: string;
}

/**
 * Distributed Load Testing on AWS main CDK Stack
 */
export class DLTStack extends Stack {
  public readonly mappings: CfnMapping;

  constructor(scope: Construct, id: string, props: DLTStackProps) {
    super(scope, id, props);

    // CFN template format version
    this.templateOptions.templateFormatVersion = "2010-09-09";
    this.templateOptions.description = props.solution.description;

    // CFN Parameters
    // Admin name
    const adminName = new CfnParameter(this, "AdminName", {
      type: "String",
      minLength: 4,
      maxLength: 20,
      allowedPattern: "[a-zA-Z0-9-]+",
      constraintDescription: "Admin username must be a minimum of 4 characters and cannot include spaces",
    });

    // Admin email
    const adminEmail = new CfnParameter(this, "AdminEmail", {
      type: "String",
      allowedPattern: "^[_A-Za-z0-9-\\+]+(\\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\\.[A-Za-z0-9]+)*(\\.[A-Za-z]{2,})$",
      constraintDescription: "Admin email must be a valid email address",
      minLength: 5,
    });

    // Existing VPC ID
    const existingVpcId = new CfnParameter(this, "ExistingVPCId", {
      type: "String",
      default: "",
      description: "Existing VPC ID",
      allowedPattern: "(?:^$|^vpc-[a-zA-Z0-9-]+)",
    });

    const existingSubnetA = new CfnParameter(this, "ExistingSubnetA", {
      type: "String",
      default: "",
      description: "First existing subnet",
      allowedPattern: "(?:^$|^subnet-[a-zA-Z0-9-]+)",
    });

    const existingSubnetB = new CfnParameter(this, "ExistingSubnetB", {
      type: "String",
      default: "",
      description: "Second existing subnet",
      allowedPattern: "(?:^$|^subnet-[a-zA-Z0-9-]+)",
    });

    const vpcCidrBlockCfnParameters = new CidrBlockCfnParameters(this, "DLTMain");

    // Egress CIDR Block
    const egressCidrBlock = new CfnParameter(this, "EgressCidr", {
      type: "String",
      default: "0.0.0.0/0",
      description: "CIDR Block to restrict the Amazon ECS container outbound access",
      minLength: 9,
      maxLength: 18,
      allowedPattern: "((\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The Egress CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
    });

    const stableTagging = new CfnParameter(this, "UseStableTagging", {
      description:
        "Automatically use the most up to date and secure image up until the next minor release. Selecting 'No' will pull the image as originally released, without any security updates.",
      type: "String",
      default: "Yes",
      allowedValues: ["Yes", "No"],
    });

    // CloudFormation metadata
    this.templateOptions.metadata = {
      "AWS::CloudFormation::Interface": {
        ParameterGroups: [
          {
            Label: { default: "Console access" },
            Parameters: [adminName.logicalId, adminEmail.logicalId],
          },
          {
            Label: { default: "Network configurations for running distributed load test Fargate tasks" },
            Parameters: [
              existingVpcId.logicalId,
              existingSubnetA.logicalId,
              existingSubnetB.logicalId,
              vpcCidrBlockCfnParameters.vpcCidrBlock.logicalId,
              vpcCidrBlockCfnParameters.subnetACidrBlock.logicalId,
              vpcCidrBlockCfnParameters.subnetBCidrBlock.logicalId,
              egressCidrBlock.logicalId,
            ],
          },
        ],
        ParameterLabels: {
          [adminName.logicalId]: { default: "* Administrator Name" },
          [adminEmail.logicalId]: { default: "* Administrator Email" },
          [existingVpcId.logicalId]: { default: "Select an existing VPC in the region" },
          [existingSubnetA.logicalId]: { default: "Select first subnet from the existing VPC" },
          [existingSubnetB.logicalId]: { default: "Select second subnet from the existing VPC" },
          [vpcCidrBlockCfnParameters.vpcCidrBlock.logicalId]: {
            default: "Provide valid CIDR block for the solution to create VPC",
          },
          [vpcCidrBlockCfnParameters.subnetACidrBlock.logicalId]: {
            default: "Provide valid CIDR block for subnet A for the solution to create VPC",
          },
          [vpcCidrBlockCfnParameters.subnetBCidrBlock.logicalId]: {
            default: "Provide valid CIDR block for subnet B for the solution to create VPC",
          },
          [egressCidrBlock.logicalId]: {
            default: "Provide CIDR block for allowing outbound traffic of AWS Fargate tasks",
          },
          [stableTagging.logicalId]: { default: "Auto-update Container Image" },
        },
      },
    };

    // CFN Rules
    // If the user enters a value for an existing VPC,
    // require the customers to fill out values for subnets A and B
    new CfnRule(this, "ExistingVPCRule", {
      ruleCondition: Fn.conditionNot(Fn.conditionEquals(existingVpcId.value, "")),
      assertions: [
        {
          assert: Fn.conditionNot(Fn.conditionEquals(existingSubnetA.value, "")),
          assertDescription:
            "If an existing VPC Id is provided, 2 subnet ids need to be provided as well. You neglected to enter the first subnet id",
        },
        {
          assert: Fn.conditionNot(Fn.conditionEquals(existingSubnetB.value, "")),
          assertDescription:
            "If an existing VPC Id is provided, 2 subnet ids need to be provided as well. You neglected to enter the second subnet id",
        },
      ],
    });

    // CFN Mappings
    const solutionMapping = new CfnMapping(this, "Solution", {
      mapping: {
        Config: {
          CodeVersion: props.solution.version,
          SendAnonymizedUsage: "Yes",
          SolutionId: props.solution.id,
        },
      },
    });

    const sendAnonymizedUsage = solutionMapping.findInMap("Config", "SendAnonymizedUsage");
    const solutionId = solutionMapping.findInMap("Config", "SolutionId");
    const solutionVersion = solutionMapping.findInMap("Config", "CodeVersion");
    const mainStackRegion = Aws.REGION;

    // CFN Conditions
    const sendAnonymizedUsageCondition = new CfnCondition(this, "SendAnonymizedUsage", {
      expression: Fn.conditionEquals(sendAnonymizedUsage, "Yes"),
    });

    const createFargateVpcResourcesCondition = new CfnCondition(this, "CreateFargateVPCResources", {
      expression: Fn.conditionEquals(existingVpcId.valueAsString, ""),
    });

    const usingExistingVpc = new CfnCondition(this, "BoolExistingVPC", {
      expression: Fn.conditionNot(Fn.conditionEquals(existingVpcId.valueAsString, "")),
    });

    const stableTagCondition = new CfnCondition(this, "UseStableTagCondition", {
      expression: Fn.conditionEquals(stableTagging.valueAsString, "Yes"),
    });

    // Fargate VPC resources
    const fargateVpc = new FargateVpcConstruct(this, "DLTVpc", {
      solutionId,
      subnetACidrBlock: vpcCidrBlockCfnParameters.subnetACidrBlock.valueAsString,
      subnetBCidrBlock: vpcCidrBlockCfnParameters.subnetBCidrBlock.valueAsString,
      vpcCidrBlock: vpcCidrBlockCfnParameters.vpcCidrBlock.valueAsString,
    });

    Aspects.of(fargateVpc).add(new ConditionAspect(createFargateVpcResourcesCondition));

    const fargateVpcId = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.vpcId,
      existingVpcId.valueAsString
    ).toString();

    const fargateSubnetA = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.subnetA,
      existingSubnetA.valueAsString
    ).toString();

    const fargateSubnetB = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.subnetB,
      existingSubnetB.valueAsString
    ).toString();

    const existingVpc = Fn.conditionIf(usingExistingVpc.logicalId, true, false).toString();

    const commonResources = new CommonResources(this, "DLTCommonResources", props.solution, props.stackType);

    const dltConsole = new DLTConsoleConstruct(this, "DLTConsoleResources", {
      s3LogsBucket: commonResources.s3LogsBucket,
      solutionId,
    });

    const dltStorage = new ScenarioTestRunnerStorageConstruct(this, "DLTTestRunnerStorage", {
      s3LogsBucket: commonResources.s3LogsBucket,
      webAppURL: dltConsole.webAppURL,
      solutionId,
    });

    // add permission and environment variables on custom resource backed lambda function
    dltStorage.scenariosBucket.grantWrite(commonResources.customResourceLambda.nodejsLambda);
    dltStorage.scenariosTable.grantReadWriteData(commonResources.customResourceLambda.nodejsLambda);
    commonResources.customResourceLambda.addEnvironmentVariables({
      MAIN_REGION: Aws.REGION,
      S3_BUCKET: dltStorage.scenariosBucket.bucketName,
      DDB_TABLE: dltStorage.scenariosTable.tableName,
    });

    const customResources = new CustomResourcesConstruct(
      this,
      "DLTCustomResources",
      commonResources.customResourceLambda.nodejsLambda
    );

    const iotEndpoint = customResources.getIotEndpoint();

    const { uuid, suffix } = customResources.uuidGenerator();

    const fargateResources = new ECSResourcesConstruct(this, "DLTEcs", {
      fargateVpcId,
      scenariosS3Bucket: dltStorage.scenariosBucket.bucketName,
      securityGroupEgress: egressCidrBlock.valueAsString,
      solutionId: props.solution.id,
      stableTagCondition: stableTagCondition.logicalId,
    });

    const realTimeDataConstruct = new RealTimeDataConstruct(this, "RealTimeData", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      iotEndpoint,
      mainRegion: Aws.REGION,
      solution: props.solution,
    });

    const stepLambdaFunctions = new TestRunnerLambdasConstruct(this, "DLTLambdaFunction", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      scenariosDynamoDbPolicy: dltStorage.scenarioDynamoDbPolicy,
      ecsTaskExecutionRoleArn: fargateResources.taskExecutionRoleArn,
      ecsCluster: fargateResources.taskClusterName,
      ecsTaskDefinition: fargateResources.taskDefinitionArn,
      ecsTaskSecurityGroup: fargateResources.ecsSecurityGroupId,
      historyTable: dltStorage.historyTable,
      historyDynamoDbPolicy: dltStorage.historyDynamoDbPolicy,
      scenariosS3Policy: dltStorage.scenariosS3Policy,
      subnetA: fargateSubnetA,
      subnetB: fargateSubnetB,
      sendAnonymizedUsage,
      solution: props.solution,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      scenariosBucketArn: dltStorage.scenariosBucket.bucketArn,
      scenariosTable: dltStorage.scenariosTable,
      uuid,
      mainStackRegion,
    });

    const taskRunnerStepFunctions = new TaskRunnerStepFunctionConstruct(this, "DLTStepFunction", {
      taskStatusChecker: stepLambdaFunctions.taskStatusChecker,
      taskRunner: stepLambdaFunctions.taskRunner,
      resultsParser: stepLambdaFunctions.resultsParser,
      taskCanceler: stepLambdaFunctions.taskCanceler,
      suffix,
    });

    const dltApi = new DLTAPI(this, "DLTApi", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      ecsTaskExecutionRoleArn: fargateResources.taskExecutionRoleArn,
      historyDynamoDbPolicy: dltStorage.historyDynamoDbPolicy,
      historyTable: dltStorage.historyTable.tableName,
      scenariosBucketName: dltStorage.scenariosBucket.bucketName,
      scenariosDynamoDbPolicy: dltStorage.scenarioDynamoDbPolicy,
      scenariosS3Policy: dltStorage.scenariosS3Policy,
      scenariosTableName: dltStorage.scenariosTable.tableName,
      taskCancelerArn: stepLambdaFunctions.taskCanceler.functionArn,
      taskCancelerInvokePolicy: stepLambdaFunctions.taskCancelerInvokePolicy,
      taskRunnerStepFunctionsArn: taskRunnerStepFunctions.taskRunnerStepFunctions.stateMachineArn,
      sendAnonymizedUsage,
      solution: props.solution,
      uuid,
    });

    const cognitoResources = new CognitoAuthConstruct(this, "DLTCognitoAuth", {
      adminEmail: adminEmail.valueAsString,
      adminName: adminName.valueAsString,
      apiId: dltApi.apiId,
      webAppURL: dltConsole.webAppURL,
      scenariosBucketArn: dltStorage.scenariosBucket.bucketArn,
    });

    customResources.detachIotPrincipalPolicy({
      iotPolicyName: cognitoResources.iotPolicy.ref,
    });

    const { DIST_OUTPUT_BUCKET, SOLUTION_NAME, VERSION, PUBLIC_ECR_REGISTRY, PUBLIC_ECR_TAG } = process.env;
    if (DIST_OUTPUT_BUCKET && SOLUTION_NAME && VERSION && PUBLIC_ECR_REGISTRY && PUBLIC_ECR_TAG) {
      const sourceBucketName = Fn.join("-", [DIST_OUTPUT_BUCKET, Aws.REGION]);
      const sourceBucket = Bucket.fromBucketName(this, "SourceCodeBucket", sourceBucketName.toString());
      sourceBucket.grantReadWrite(commonResources.customResourceLambda.nodejsLambda);
      customResources.putRegionalTemplate({
        sourceCodeBucketName: sourceBucketName,
        regionalTemplatePrefix: `${SOLUTION_NAME}/${VERSION}`,
        scenariosBucket: dltStorage.scenariosBucket.bucketName,
        scenariosTable: dltStorage.scenariosTable.tableName,
        lambdaTaskRoleArn: stepLambdaFunctions.lambdaTaskRole.roleArn,
        mainStackRegion,
      });
    }
    customResources.consoleConfig({
      apiEndpoint: dltApi.apiEndpointPath,
      cognitoIdentityPool: cognitoResources.cognitoIdentityPoolId,
      cognitoUserPool: cognitoResources.cognitoUserPoolId,
      cognitoUserPoolClient: cognitoResources.cognitoUserPoolClientId,
      consoleBucket: dltConsole.consoleBucket as Bucket,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      iotEndpoint,
      iotPolicy: cognitoResources.iotPolicy.ref,
    });

    customResources.testingResourcesConfigCR({
      taskCluster: fargateResources.taskClusterName,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup.logGroupName,
      taskSecurityGroup: fargateResources.ecsSecurityGroupId,
      taskDefinition: fargateResources.taskDefinitionArn,
      subnetA: fargateSubnetA,
      subnetB: fargateSubnetB,
    });

    customResources.sendAnonymizedMetricsCR({
      existingVpc,
      solutionId,
      uuid,
      solutionVersion,
      sendAnonymizedUsage,
      sendAnonymizedUsageCondition,
    });

    // metrics

    const solutionsMetrics = new SolutionsMetrics(this, "SolutionMetricsNew", {
      uuid,
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.taskRunner.functionName,
      identifier: "TaskRunner",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: realTimeDataConstruct.realTimeDataPublisher.functionName,
      identifier: "RealTimeDataPublisher",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.resultsParser.functionName,
      identifier: "ResultsParser",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.taskCanceler.functionName,
      identifier: "TaskCanceler",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.taskStatusChecker.functionName,
      identifier: "TaskStatusChecker",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: commonResources.customResourceLambda.nodejsLambda.functionName,

      identifier: "CustomResourceLambda",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.taskRunnerLambdaLogGroup],
      identifier: "TaskRunner",
    });

    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [realTimeDataConstruct.realTimeDataPublisherLogGroup],
      identifier: "RealTimeDataPublisher",
    });

    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.resultsParserLambdaLogGroup],
      identifier: "ResultsParser",
    });

    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.taskCancelerLambdaLogGroup],
      identifier: "TaskCanceler",
    });

    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.taskStatusCheckerLambdaLogGroup],
      identifier: "TaskStatusChecker",
    });

    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [dltApi.apiLambdaLogGroup],
      identifier: "ApiLambda",
    });

    solutionsMetrics.addDynamoDBConsumedReadCapacityUnits({
      tableName: dltStorage.scenariosTable.tableName,
      identifier: "ScenariosTable",
    });
    solutionsMetrics.addDynamoDBConsumedReadCapacityUnits({
      tableName: dltStorage.historyTable.tableName,
      identifier: "HistoryTable",
    });
    solutionsMetrics.addDynamoDBConsumedWriteCapacityUnits({
      tableName: dltStorage.scenariosTable.tableName,
      identifier: "ScenariosTable",
    });
    solutionsMetrics.addDynamoDBConsumedWriteCapacityUnits({
      tableName: dltStorage.historyTable.tableName,
      identifier: "HistoryTable",
    });

    solutionsMetrics.addECSAverageCPUUtilization({
      clusterName: fargateResources.taskClusterName,
      taskDefinitionFamily: fargateResources.taskDefinitionFamily,
    });
    solutionsMetrics.addECSAverageMemoryUtilization({
      clusterName: fargateResources.taskClusterName,
      taskDefinitionFamily: fargateResources.taskDefinitionFamily,
    });

    Aspects.of(solutionsMetrics).add(new ConditionAspect(sendAnonymizedUsageCondition));

    // Outputs
    new CfnOutput(this, "Console URL", {
      description: "Web portal for DLT",
      value: dltConsole.webAppURL,
    });
    new CfnOutput(this, "SolutionUUID", {
      description: "Unique ID for deployment",
      value: uuid,
    });
    new CfnOutput(this, "ScenariosBucket", {
      description: "Common storage bucket for test scenarios",
      value: dltStorage.scenariosBucket.bucketName,
    });
    new CfnOutput(this, "ScenariosTable", {
      description: "Common table for storing load test details",
      value: dltStorage.scenariosTable.tableName,
    });
    new CfnOutput(this, "RegionalCFTemplate", {
      description: "S3 URL for regional CloudFormation template",
      value: dltStorage.scenariosBucket.urlForObject(
        "regional-template/distributed-load-testing-on-aws-regional.template"
      ),
      exportName: "RegionalCFTemplate",
    });
  }
}
