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
import { CommonResourcesConstruct } from "./common-resources/common-resources";
import { ECSResourcesConstruct } from "./testing-resources/ecs";
import { CustomResourceInfraConstruct } from "./custom-resources/custom-resources-infra";
import { CustomResourcesConstruct } from "./custom-resources/custom-resources";
import { RegionalPermissionsConstruct } from "./testing-resources/regional-permissions";
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
 * RegionalInfrastructureDLTStack props
 *
 * @interface RegionalInfrastructureDLTStackProps
 */
export interface RegionalInfrastructureDLTStackProps extends StackProps {
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
 * Distributed Load Testing on AWS regional infrastructure deployment
 */
export class RegionalInfrastructureDLTStack extends Stack {
  // VPC ID
  private fargateVpcId: string;
  // Subnets for Fargate tasks
  private fargateSubnetA: string;
  private fargateSubnetB: string;

  constructor(scope: Construct, id: string, props: RegionalInfrastructureDLTStackProps) {
    super(scope, id, props);

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
      description: "CIDR Block to restrict the Fargate container outbound access",
      minLength: 9,
      maxLength: 18,
      allowedPattern: "(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The Egress CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
    });

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
          APIServicesLambdaRoleName: "API_SERVICES_ROLE",
          CodeVersion: props.codeVersion,
          ContainerImage: `${props.publicECRRegistry}/distributed-load-testing-on-aws-load-tester:${props.publicECRTag}`,
          KeyPrefix: `${props.solutionName}/${props.codeVersion}`,
          MainStackRegion: "MAIN_STACK_REGION",
          ResultsParserRoleName: "RESULTS_PARSER_ROLE",
          S3Bucket: props.codeBucket,
          ScenariosS3Bucket: "SCENARIOS_BUCKET",
          ScenariosTable: "SCENARIOS_DDB_TABLE",
          SendAnonymizedUsage: "Yes",
          SolutionId: props.solutionId,
          stackType: props.stackType,
          TaskRunnerRoleName: "TASK_RUNNER_ROLE",
          TaskCancelerRoleName: "TASK_CANCELER_ROLE",
          TaskStatusCheckerRoleName: "TASK_STATUS_ROLE",
          URL: props.url,
          Uuid: "STACK_UUID",
        },
      },
    });
    const apiServicesLambdaRoleName = solutionMapping.findInMap("Config", "APIServicesLambdaRoleName");
    const containerImage = solutionMapping.findInMap("Config", "ContainerImage");
    const mainStackRegion = solutionMapping.findInMap("Config", "MainStackRegion");
    const metricsUrl = solutionMapping.findInMap("Config", "URL");
    const resultsParserRoleName = solutionMapping.findInMap("Config", "ResultsParserRoleName");
    const scenariosS3Bucket = solutionMapping.findInMap("Config", "ScenariosS3Bucket");
    const scenariosTable = solutionMapping.findInMap("Config", "ScenariosTable");
    const sendAnonymizedUsage = solutionMapping.findInMap("Config", "SendAnonymizedUsage");
    const solutionId = solutionMapping.findInMap("Config", "SolutionId");
    const solutionVersion = solutionMapping.findInMap("Config", "CodeVersion");
    const sourceCodeBucket = Fn.join("-", [solutionMapping.findInMap("Config", "S3Bucket"), Aws.REGION]);
    const sourceCodePrefix = solutionMapping.findInMap("Config", "KeyPrefix");
    const taskRunnerRoleName = solutionMapping.findInMap("Config", "TaskRunnerRoleName");
    const taskCancelerRoleName = solutionMapping.findInMap("Config", "TaskCancelerRoleName");
    const taskStatusCheckerRoleName = solutionMapping.findInMap("Config", "TaskStatusCheckerRoleName");
    const uuid = solutionMapping.findInMap("Config", "Uuid");

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

    const commonResources = new CommonResourcesConstruct(this, "CommonResources", {
      sourceCodeBucket,
    });

    // Fargate VPC resources
    const fargateVpc = new FargateVpcConstruct(this, "DLTRegionalVpc", {
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

    // ECS Fargate resources
    const fargateResources = new ECSResourcesConstruct(this, "DLTRegionalFargate", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      containerImage,
      fargateVpcId: this.fargateVpcId,
      scenariosS3Bucket,
      securityGroupEgress: egressCidrBlock.valueAsString,
      solutionId,
    });

    const customResourceInfra = new CustomResourceInfraConstruct(this, "RegionalCustomResourceInfra", {
      cloudWatchPolicy: commonResources.cloudWatchLogsPolicy,
      mainStackRegion,
      metricsUrl,
      scenariosS3Bucket,
      scenariosTable,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
      stackType: props.stackType,
    });

    new RegionalPermissionsConstruct(this, "RegionalPermissionsForTaskLambdas", {
      apiServicesLambdaRoleName,
      ecsCloudWatchLogGroupArn: fargateResources.ecsCloudWatchLogGroup.logGroupArn,
      resultsParserRoleName,
      taskExecutionRoleArn: fargateResources.taskExecutionRoleArn,
      taskRunnerRoleName,
      taskCancelerRoleName,
      taskStatusCheckerRoleName,
    });

    const customResources = new CustomResourcesConstruct(this, "DLTCustomResources", {
      customResourceLambdaArn: customResourceInfra.customResourceArn,
    });

    const iotEndpoint = customResources.getIotEndpoint();

    new RealTimeDataConstruct(this, "RealTimeData", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      iotEndpoint,
      mainRegion: mainStackRegion,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
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
    new CfnOutput(this, "ECSCloudWatchLogGroup", {
      description: "The CloudWatch log group for ECS",
      value: fargateResources.ecsCloudWatchLogGroup.logGroupName,
    });
    new CfnOutput(this, "SubnetA", {
      description: "Subnet A used by the Fargate tasks",
      value: this.fargateSubnetA,
    });
    new CfnOutput(this, "SubnetB", {
      description: "Subnet B used by the Fargate tasks",
      value: this.fargateSubnetB,
    });
    new CfnOutput(this, "TaskCluster", {
      description: "Fargate task cluster",
      value: fargateResources.taskClusterName,
    });
    new CfnOutput(this, "TaskDefinition", {
      description: "The Fargate task definition",
      value: fargateResources.taskDefinitionArn,
    });
    new CfnOutput(this, "TaskSecurityGroup", {
      description: "Security Group used by the Fargate taks",
      value: fargateResources.ecsSecurityGroupId,
    });
  }
}
