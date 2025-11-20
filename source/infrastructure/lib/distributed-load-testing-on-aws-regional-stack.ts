// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  ArnFormat,
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
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, Policy, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct, IConstruct } from "constructs";
import { SolutionsMetrics } from "../../metrics-utils";
import { Solution } from "../bin/solution";
import { CidrBlockCfnParameters } from "./common-resources/common-cfn-parameters";
import { CommonResources } from "./common-resources/common-resources";
import { CustomResourcesConstruct } from "./common-resources/custom-resources";
import { ECSResourcesConstruct } from "./testing-resources/ecs";
import { RealTimeDataConstruct } from "./testing-resources/real-time-data";
import { FargateVpcConstruct } from "./testing-resources/vpc";

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
  solution: Solution;
  stackType: string;
}

/**
 * Distributed Load Testing on AWS regional infrastructure deployment
 */
export class RegionalInfrastructureDLTStack extends Stack {
  constructor(scope: Construct, id: string, props: RegionalInfrastructureDLTStackProps) {
    super(scope, id, props);

    // Load context variables
    const shouldBuildFromSource = this.node.tryGetContext("buildFromSource") === "true";

    this.templateOptions.description = props.solution.description;

    // Existing VPC ID
    const existingVpcId = new CfnParameter(this, "ExistingVPCId", {
      type: "String",
      allowedPattern: "(^$|^vpc-[a-zA-Z0-9-]+)",
      default: "",
    });

    const existingSubnetA = new CfnParameter(this, "ExistingSubnetA", {
      type: "String",
      allowedPattern: "(^$|^subnet-[a-zA-Z0-9-]+)",
      default: "",
    });

    const existingSubnetB = new CfnParameter(this, "ExistingSubnetB", {
      type: "String",
      allowedPattern: "(^$|^subnet-[a-zA-Z0-9-]+)",
      default: "",
    });

    const vpcCidrBlockCfnParameters = new CidrBlockCfnParameters(this, "DLTRegional");

    vpcCidrBlockCfnParameters.vpcCidrBlock.overrideLogicalId("VpcCidrBlock");
    vpcCidrBlockCfnParameters.subnetACidrBlock.overrideLogicalId("SubnetACidrBlock");
    vpcCidrBlockCfnParameters.subnetBCidrBlock.overrideLogicalId("SubnetBCidrBlock");

    // Egress CIDR Block
    const egressCidrBlock = new CfnParameter(this, "EgressCidr", {
      type: "String",
      default: "0.0.0.0/0",
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

    // CFN Mappings
    const solutionMapping = new CfnMapping(this, "Solution", {
      mapping: {
        Config: {
          MainRegionLambdaTaskRoleArn: "Main_Region_Lambda_Task_Role_Arn",
          MainRegionStack: "Main_Region_Stack",
          ScenariosBucket: "Scenarios_Bucket",
          ScenariosTable: "Scenarios_Table",
        },
      },
    });

    const config = this.getRegionalConfig(shouldBuildFromSource, solutionMapping);
    const { mainRegionLambdaTaskRoleArn, mainStackRegion, scenariosBucket, scenariosTable } = config;

    // CloudFormation metadata
    this.templateOptions.metadata = {
      "AWS::CloudFormation::Interface": {
        ParameterGroups: [
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
          [egressCidrBlock.logicalId]: { default: "Provide CIDR block for allowing outbound traffic of Fargate tasks" },
          [stableTagging.logicalId]: { default: "Auto-update Container Image" },
        },
      },
    };

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

    const createFargateVpcResourcesCondition = new CfnCondition(this, "CreateFargateVPCResources", {
      expression: Fn.conditionEquals(existingVpcId.valueAsString, ""),
    });

    const stableTagCondition = new CfnCondition(this, "UseStableTagCondition", {
      expression: Fn.conditionEquals(stableTagging.valueAsString, "Yes"),
    });

    const commonResources = new CommonResources(this, "CommonResources", props.solution, props.stackType);
    commonResources.customResourceLambda.addEnvironmentVariables({
      MAIN_REGION: mainStackRegion.toString(),
      S3_BUCKET: scenariosBucket.toString(),
      DDB_TABLE: scenariosTable.toString(),
    });

    // add permission on primary scenarios table and bucket for custom resource backed lambda deployed in regional stack
    const _scenariosBucket = Bucket.fromBucketName(this, "PrimaryScenariosBucket", scenariosBucket.toString());
    _scenariosBucket.grantWrite(commonResources.customResourceLambda.nodejsLambda);
    const _scenariosTable = Table.fromTableArn(
      this,
      "PrimaryScenariosTable",
      Stack.of(this).formatArn({
        service: "dynamodb",
        resource: "table",
        resourceName: scenariosTable.toString(),
        region: mainStackRegion.toString(),
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      })
    );
    _scenariosTable.grantReadWriteData(commonResources.customResourceLambda.nodejsLambda);

    (commonResources.customResourceLambda.nodejsLambda.node.defaultChild as CfnResource).overrideLogicalId(
      "RegionalCustomResourceInfraCustomResourceLambda86A7E873"
    );

    // Fargate VPC resources
    const fargateVpc = new FargateVpcConstruct(this, "DLTVpc", {
      solutionId: props.solution.id,
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

    // ECS Fargate resources
    const fargateResources = new ECSResourcesConstruct(this, "DLTRegionalFargate", {
      fargateVpcId,
      securityGroupEgress: egressCidrBlock.valueAsString,
      scenariosS3Bucket: scenariosBucket.toString(),
      solutionId: props.solution.id,
      stableTagCondition: stableTagCondition.logicalId,
      buildFromSource: shouldBuildFromSource,
    });

    const ecsPolicyName = `RegionalECRPerms-${Aws.STACK_NAME}-${Aws.REGION}`;
    const lambdaTaskRole = Role.fromRoleArn(
      this,
      "RegionalPermissionsForTaskRole",
      mainRegionLambdaTaskRoleArn.toString()
    );
    lambdaTaskRole.attachInlinePolicy(
      new Policy(this, "RegionalECRPerms", {
        policyName: ecsPolicyName,
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["iam:PassRole"],
            resources: [fargateResources.taskExecutionRoleArn],
          }),
        ],
      })
    );

    const customResources = new CustomResourcesConstruct(
      this,
      "DLTCustomResources",
      commonResources.customResourceLambda.nodejsLambda
    );

    const iotEndpoint = customResources.getIotEndpoint();

    new RealTimeDataConstruct(this, "RealTimeData", {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      iotEndpoint,
      mainRegion: mainStackRegion.toString(),
      solution: props.solution,
    });

    customResources.testingResourcesConfigCR({
      taskCluster: fargateResources.taskClusterName,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup.logGroupName,
      taskSecurityGroup: fargateResources.ecsSecurityGroupId,
      taskDefinition: fargateResources.taskDefinitionArn,
      subnetA: fargateSubnetA,
      subnetB: fargateSubnetB,
    });

    const { uuid } = customResources.uuidGenerator();

    const solutionsMetrics = new SolutionsMetrics(this, "SolutionMetricsNew", {
      uuid,
    });
    solutionsMetrics.addECSAverageCPUUtilization({
      clusterName: fargateResources.taskClusterName,
      taskDefinitionFamily: fargateResources.taskDefinitionFamily,
    });
    solutionsMetrics.addECSAverageMemoryUtilization({
      clusterName: fargateResources.taskClusterName,
      taskDefinitionFamily: fargateResources.taskDefinitionFamily,
    });

    // Outputs
    new CfnOutput(this, "ECSCloudWatchLogGroup", {
      description: "The CloudWatch log group for ECS",
      value: fargateResources.ecsCloudWatchLogGroup.logGroupName,
    });
    new CfnOutput(this, "TaskCluster", {
      description: "Fargate task cluster",
      value: fargateResources.taskClusterName,
    });
  }

  /**
   * Resolves regional configuration values from context (local development) or CloudFormation mapping (published template)
   *
   * @param {string} shouldBuildFromSource Whether building from source code locally instead of default published template
   * @param {CfnMapping} solutionMapping The CloudFormation mapping containing default values
   * @returns {object} Configuration object with resolved values
   */
  private getRegionalConfig(shouldBuildFromSource: boolean, solutionMapping: CfnMapping) {
    // For local development: build the regional stack from source
    const lambdaTaskRoleArnOverride = this.node.tryGetContext("lambdaTaskRoleArn");
    const mainRegionOverride = this.node.tryGetContext("mainRegion");
    const scenariosBucketOverride = this.node.tryGetContext("scenariosBucket");
    const scenariosTableOverride = this.node.tryGetContext("scenariosTable");
    if (
      shouldBuildFromSource &&
      lambdaTaskRoleArnOverride &&
      mainRegionOverride &&
      scenariosBucketOverride &&
      scenariosTableOverride
    ) {
      return {
        mainRegionLambdaTaskRoleArn: lambdaTaskRoleArnOverride,
        mainStackRegion: mainRegionOverride,
        scenariosBucket: scenariosBucketOverride,
        scenariosTable: scenariosTableOverride,
      };
    }

    // Default behavior: use mappings from published template
    return {
      mainRegionLambdaTaskRoleArn: solutionMapping.findInMap("Config", "MainRegionLambdaTaskRoleArn"),
      mainStackRegion: solutionMapping.findInMap("Config", "MainRegionStack"),
      scenariosBucket: solutionMapping.findInMap("Config", "ScenariosBucket"),
      scenariosTable: solutionMapping.findInMap("Config", "ScenariosTable"),
    };
  }
}
