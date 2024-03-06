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
  Tags,
} from "aws-cdk-lib";
import { Construct, IConstruct } from "constructs";
import { DLTAPI } from "./front-end/api";
import { CognitoAuthConstruct } from "./front-end/auth";
import { CommonResourcesConstruct } from "./common-resources/common-resources";
import { DLTConsoleConstruct } from "./front-end/console";
import { CustomResourcesConstruct } from "./custom-resources/custom-resources";
import { CustomResourceInfraConstruct } from "./custom-resources/custom-resources-infra";
import { ECSResourcesConstruct } from "./testing-resources/ecs";
import { ScenarioTestRunnerStorageConstruct } from "./back-end/scenarios-storage";
import { TaskRunnerStepFunctionConstruct } from "./back-end/step-functions";
import { TestRunnerLambdasConstruct } from "./back-end/test-task-lambdas";
import { FargateVpcConstruct } from "./testing-resources/vpc";
import { RealTimeDataConstruct } from "./testing-resources/real-time-data";

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
  readonly codeBucket: string;
  readonly codeVersion: string;
  readonly description: string;
  readonly publicECRRegistry: string;
  readonly publicECRTag: string;
  readonly stackType: string;
  readonly solutionId: string;
  readonly solutionName: string;
  readonly url: string;
}

/**
 * Distributed Load Testing on AWS main CDK Stack
 */
export class DLTStack extends Stack {
  // VPC ID
  private fargateVpcId: string;
  // Subnets for Fargate tasks
  private fargateSubnetA: string;
  private fargateSubnetB: string;

  constructor(scope: Construct, id: string, props: DLTStackProps) {
    super(scope, id, props);

    // CFN template format version
    this.templateOptions.templateFormatVersion = "2010-09-09";

    // CFN Parameters
    // Admin name
    const adminName = new CfnParameter(this, "AdminName", {
      type: "String",
      description: "Admin user name to access the Distributed Load Testing console",
      minLength: 4,
      maxLength: 20,
      allowedPattern: "[a-zA-Z0-9-]+",
      constraintDescription: "Admin username must be a minimum of 4 characters and cannot include spaces",
    });

    // Admin email
    const adminEmail = new CfnParameter(this, "AdminEmail", {
      type: "String",
      description: "Admin user email address to access the Distributed Load Testing Console",
      allowedPattern: "^[_A-Za-z0-9-\\+]+(\\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\\.[A-Za-z0-9]+)*(\\.[A-Za-z]{2,})$",
      constraintDescription: "Admin email must be a valid email address",
      minLength: 5,
    });

    // Existing VPC ID
    const existingVpcId = new CfnParameter(this, "ExistingVPCId", {
      type: "String",
      description: "Existing VPC ID",
      allowedPattern: "(?:^$|^vpc-[a-zA-Z0-9-]+)",
    });

    const existingSubnetA = new CfnParameter(this, "ExistingSubnetA", {
      type: "String",
      description: "First existing subnet",
      allowedPattern: "(?:^$|^subnet-[a-zA-Z0-9-]+)",
    });

    const existingSubnetB = new CfnParameter(this, "ExistingSubnetB", {
      type: "String",
      description: "Second existing subnet",
      allowedPattern: "(?:^$|^subnet-[a-zA-Z0-9-]+)",
    });

    // VPC CIDR Block
    const vpcCidrBlock = new CfnParameter(this, "VpcCidrBlock", {
      type: "String",
      default: "192.168.0.0/16",
      description: "CIDR block of the new VPC where AWS Fargate will be placed",
      allowedPattern: "(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The VPC CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
      minLength: 9,
      maxLength: 18,
    });

    // Subnet A CIDR Block
    const subnetACidrBlock = new CfnParameter(this, "SubnetACidrBlock", {
      type: "String",
      default: "192.168.0.0/20",
      description: "CIDR block for subnet A of the AWS Fargate VPC",
      allowedPattern: "(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
      minLength: 9,
      maxLength: 18,
    });

    // Subnet B CIDR Block
    const subnetBCidrBlock = new CfnParameter(this, "SubnetBCidrBlock", {
      type: "String",
      default: "192.168.16.0/20",
      description: "CIDR block for subnet B of the AWS Fargate VPC",
      allowedPattern: "(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
    });

    // Egress CIDR Block
    const egressCidrBlock = new CfnParameter(this, "EgressCidr", {
      type: "String",
      default: "0.0.0.0/0",
      description: "CIDR Block to restrict the ECS container outbound access",
      minLength: 9,
      maxLength: 18,
      allowedPattern: "(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The Egress CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
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
            Label: { default: "Enter values here to use your own existing VPC" },
            Parameters: [existingVpcId.logicalId, existingSubnetA.logicalId, existingSubnetB.logicalId],
          },
          {
            Label: { default: "Or have the solution create a new AWS Fargate VPC" },
            Parameters: [
              vpcCidrBlock.logicalId,
              subnetACidrBlock.logicalId,
              subnetBCidrBlock.logicalId,
              egressCidrBlock.logicalId,
            ],
          },
        ],
        ParameterLabels: {
          [adminName.logicalId]: { default: "* Console Administrator Name" },
          [adminEmail.logicalId]: { default: "* Console Administrator Email" },
          [existingVpcId.logicalId]: { default: "The ID of an existing VPC in this region. Ex: `vpc-1a2b3c4d5e6f`" },
          [existingSubnetA.logicalId]: { default: "The ID of a subnet within the existing VPC. Ex: `subnet-7h8i9j0k`" },
          [existingSubnetB.logicalId]: { default: "The ID of a subnet within the existing VPC. Ex: `subnet-1x2y3z`" },
          [vpcCidrBlock.logicalId]: { default: "AWS Fargate VPC CIDR Block" },
          [subnetACidrBlock.logicalId]: { default: "AWS Fargate Subnet A CIDR Block" },
          [subnetBCidrBlock.logicalId]: { default: "AWS Fargate Subnet A CIDR Block" },
          [egressCidrBlock.logicalId]: { default: "AWS Fargate SecurityGroup CIDR Block" },
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
          CodeVersion: props.codeVersion,
          ContainerImage: `${props.publicECRRegistry}/distributed-load-testing-on-aws-load-tester:${props.publicECRTag}`,
          KeyPrefix: `${props.solutionName}/${props.codeVersion}`,
          S3Bucket: props.codeBucket,
          SendAnonymizedUsage: "Yes",
          SolutionId: props.solutionId,
          URL: props.url,
        },
      },
    });
    const sendAnonymizedUsage = solutionMapping.findInMap("Config", "SendAnonymizedUsage");
    const solutionId = solutionMapping.findInMap("Config", "SolutionId");
    const solutionVersion = solutionMapping.findInMap("Config", "CodeVersion");
    const sourceCodeBucket = Fn.join("-", [solutionMapping.findInMap("Config", "S3Bucket"), Aws.REGION]);
    const sourceCodePrefix = solutionMapping.findInMap("Config", "KeyPrefix");
    const metricsUrl = solutionMapping.findInMap("Config", "URL");
    const containerImage = solutionMapping.findInMap("Config", "ContainerImage");
    const mainStackRegion = Aws.REGION;

    // Stack level tags
    Tags.of(this).add("SolutionId", solutionId);

    // Stack level tags
    Tags.of(this).add("SolutionId", solutionId);

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

    // Fargate VPC resources
    const fargateVpc = new FargateVpcConstruct(this, "DLTVpc", {
      solutionId,
      subnetACidrBlock: subnetACidrBlock.valueAsString,
      subnetBCidrBlock: subnetBCidrBlock.valueAsString,
      vpcCidrBlock: vpcCidrBlock.valueAsString,
    });
    Aspects.of(fargateVpc).add(new ConditionAspect(createFargateVpcResourcesCondition));
    this.fargateVpcId = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.vpcId,
      existingVpcId.valueAsString
    ).toString();

    this.fargateSubnetA = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.subnetA,
      existingSubnetA.valueAsString
    ).toString();

    this.fargateSubnetB = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.subnetB,
      existingSubnetB.valueAsString
    ).toString();

    const existingVpc = Fn.conditionIf(usingExistingVpc.logicalId, true, false).toString();

    const commonResources = new CommonResourcesConstruct(this, "DLTCommonResources", {
      sourceCodeBucket,
    });

    const s3LogsBucket = commonResources.s3LogsBucket();

    const dltConsole = new DLTConsoleConstruct(this, "DLTConsoleResources", {
      s3LogsBucket,
      solutionId,
    });

    const dltStorage = new ScenarioTestRunnerStorageConstruct(this, "DLTTestRunnerStorage", {
      s3LogsBucket,
      cloudFrontDomainName: dltConsole.cloudFrontDomainName,
      solutionId,
    });

    const customResourceInfra = new CustomResourceInfraConstruct(this, "DLTCustomResourceInfra", {
      cloudWatchPolicy: commonResources.cloudWatchLogsPolicy,
      consoleBucketArn: dltConsole.consoleBucketArn,
      mainStackRegion,
      metricsUrl,
      scenariosS3Bucket: dltStorage.scenariosBucket.bucketName,
      scenariosTable: dltStorage.scenariosTable.tableName,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
      stackType: props.stackType,
    });

    const customResources = new CustomResourcesConstruct(this, "DLTCustomResources", {
      customResourceLambdaArn: customResourceInfra.customResourceArn,
    });

    const iotEndpoint = customResources.getIotEndpoint();

    const { uuid, suffix } = customResources.uuidGenerator();

    const fargateResources = new ECSResourcesConstruct(this, "DLTEcs", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      containerImage,
      fargateVpcId: this.fargateVpcId,
      scenariosS3Bucket: dltStorage.scenariosBucket.bucketName,
      securityGroupEgress: egressCidrBlock.valueAsString,
      solutionId,
    });

    new RealTimeDataConstruct(this, "RealTimeData", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      iotEndpoint,
      mainRegion: Aws.REGION,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
    });

    const stepLambdaFunctions = new TestRunnerLambdasConstruct(this, "DLTLambdaFunction", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      scenariosDynamoDbPolicy: dltStorage.scenarioDynamoDbPolicy,
      ecsTaskExecutionRoleArn: fargateResources.taskExecutionRoleArn,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      ecsCluster: fargateResources.taskClusterName,
      ecsTaskDefinition: fargateResources.taskDefinitionArn,
      ecsTaskSecurityGroup: fargateResources.ecsSecurityGroupId,
      historyTable: dltStorage.historyTable,
      historyDynamoDbPolicy: dltStorage.historyDynamoDbPolicy,
      scenariosS3Policy: dltStorage.scenariosS3Policy,
      subnetA: this.fargateSubnetA,
      subnetB: this.fargateSubnetB,
      metricsUrl,
      sendAnonymizedUsage,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      scenariosTable: dltStorage.scenariosTable,
      uuid,
      mainStackRegion,
    });

    const taskRunnerStepFunctions = new TaskRunnerStepFunctionConstruct(this, "DLTStepFunction", {
      taskStatusChecker: stepLambdaFunctions.taskStatusChecker,
      taskRunner: stepLambdaFunctions.taskRunner,
      resultsParser: stepLambdaFunctions.resultsParser,
      taskCanceler: stepLambdaFunctions.taskCanceler,
      solutionId,
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
      metricsUrl,
      sendAnonymizedUsage,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
      uuid,
    });

    const cognitoResources = new CognitoAuthConstruct(this, "DLTCognitoAuth", {
      adminEmail: adminEmail.valueAsString,
      adminName: adminName.valueAsString,
      apiId: dltApi.apiId,
      cloudFrontDomainName: dltConsole.cloudFrontDomainName,
      scenariosBucketArn: dltStorage.scenariosBucket.bucketArn,
    });

    customResources.copyConsoleFiles({
      consoleBucketName: dltConsole.consoleBucket.bucketName,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      sourceCodeBucketName: sourceCodeBucket,
      sourceCodePrefix,
    });

    customResources.putRegionalTemplate({
      sourceCodeBucketName: sourceCodeBucket,
      regionalTemplatePrefix: sourceCodePrefix,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      mainStackRegion,
      apiServicesLambdaRoleName: dltApi.apiServicesLambdaRoleName,
      resultsParserRoleName: stepLambdaFunctions.resultsParser.role!.roleName,
      scenariosTable: dltStorage.scenariosTable.tableName,
      taskRunnerRoleName: stepLambdaFunctions.taskRunner.role!.roleName,
      taskCancelerRoleName: stepLambdaFunctions.taskCanceler.role!.roleName,
      taskStatusCheckerRoleName: stepLambdaFunctions.taskStatusChecker.role!.roleName,
      uuid,
    });

    customResources.detachIotPrincipalPolicy({
      iotPolicyName: cognitoResources.iotPolicy.ref,
    });

    customResources.consoleConfig({
      apiEndpoint: dltApi.apiEndpointPath,
      cognitoIdentityPool: cognitoResources.cognitoIdentityPoolId,
      cognitoUserPool: cognitoResources.cognitoUserPoolId,
      cognitoUserPoolClient: cognitoResources.cognitoUserPoolClientId,
      consoleBucketName: dltConsole.consoleBucket.bucketName,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      sourceCodeBucketName: sourceCodeBucket,
      sourceCodePrefix,
      iotEndpoint,
      iotPolicy: cognitoResources.iotPolicy.ref,
    });

    customResources.testingResourcesConfigCR({
      taskCluster: fargateResources.taskClusterName,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup.logGroupName,
      taskSecurityGroup: fargateResources.ecsSecurityGroupId,
      taskDefinition: fargateResources.taskDefinitionArn,
      subnetA: this.fargateSubnetA,
      subnetB: this.fargateSubnetB,
      uuid,
    });

    customResources.sendAnonymizedMetricsCR({
      existingVpc,
      solutionId,
      uuid,
      solutionVersion,
      sendAnonymizedUsage,
      sendAnonymizedUsageCondition,
    });

    commonResources.appRegistryApplication({
      description: props.description,
      solutionVersion,
      stackType: props.stackType,
      solutionId,
      applicationName: props.solutionName,
    });

    // Outputs
    new CfnOutput(this, "Console", {
      description: "Console URL",
      value: dltConsole.cloudFrontDomainName,
    });
    new CfnOutput(this, "SolutionUUID", {
      description: "Solution UUID",
      value: uuid,
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
