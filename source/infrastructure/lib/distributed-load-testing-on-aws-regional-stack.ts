// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  ArnFormat,
  Aspects,
  CfnCondition,
  CfnOutput,
  CfnParameter,
  CfnResource,
  CfnMapping,
  CfnRule,
  Fn,
  IAspect,
  Stack,
  StackProps,
  Aws,
} from "aws-cdk-lib";
import { Construct, IConstruct } from "constructs";
import { ECSResourcesConstruct } from "./testing-resources/ecs";
import { CustomResourcesConstruct } from "./common-resources/custom-resources";
import { FargateVpcConstruct } from "./testing-resources/vpc";
import { RealTimeDataConstruct } from "./testing-resources/real-time-data";
import { Solution } from "../bin/solution";
import { CommonResources } from "./common-resources/common-resources";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { SolutionsMetrics } from "../../metrics-utils";
import { Policy, Role, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";

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

    // VPC CIDR Block
    const vpcCidrBlock = new CfnParameter(this, "VpcCidrBlock", {
      type: "String",
      default: "192.168.0.0/16",
      description: "You may leave this parameter blank if you are using existing VPC",
      allowedPattern: "(^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The VPC CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
      minLength: 9,
      maxLength: 18,
    });

    // Egress CIDR Block
    const egressCidrBlock = new CfnParameter(this, "EgressCidr", {
      type: "String",
      default: "0.0.0.0/0",
      minLength: 9,
      maxLength: 18,
      allowedPattern: "((\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The Egress CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
    });

    // CFN Mappings
    const solutionMapping = new CfnMapping(this, "Solution", {
      mapping: {
        Config: {
          MainRegionLambdaTaskRoleArn: "Main_Region_Lambda_Task_Role_Arn",
          MainRegionStack: "Main_Region_Stack",
          ScenariosBucket: "Scenarios_Bucket",
          ScenariosTable: "Scenarios_Table",
          SendAnonymizedUsage: "Yes",
        },
      },
    });
    const mainRegionLambdaTaskRoleArn = solutionMapping.findInMap("Config", "MainRegionLambdaTaskRoleArn");
    const mainStackRegion = solutionMapping.findInMap("Config", "MainRegionStack");
    const scenariosBucket = solutionMapping.findInMap("Config", "ScenariosBucket");
    const scenariosTable = solutionMapping.findInMap("Config", "ScenariosTable");
    const sendAnonymizedUsage = solutionMapping.findInMap("Config", "SendAnonymizedUsage");

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
              vpcCidrBlock.logicalId,
              egressCidrBlock.logicalId,
            ],
          },
        ],
        ParameterLabels: {
          [existingVpcId.logicalId]: { default: "Select an existing VPC in the region" },
          [existingSubnetA.logicalId]: { default: "Select first subnet from the existing VPC" },
          [existingSubnetB.logicalId]: { default: "Select second subnet from the existing VPC" },
          [vpcCidrBlock.logicalId]: { default: "Provide valid CIDR block for the solution to create VPC" },
          [egressCidrBlock.logicalId]: { default: "Provide CIDR block for allowing outbound traffic of Fargate tasks" },
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

    const sendAnonymizedUsageCondition = new CfnCondition(this, "SendAnonymizedUsage", {
      expression: Fn.conditionEquals(sendAnonymizedUsage, "Yes"),
    });

    const createFargateVpcResourcesCondition = new CfnCondition(this, "CreateFargateVPCResources", {
      expression: Fn.conditionEquals(existingVpcId.valueAsString, ""),
    });

    const commonResources = new CommonResources(this, "CommonResources", props.solution);
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
    const fargateVpc = new FargateVpcConstruct(this, "DLTRegionalVpc", vpcCidrBlock.valueAsString);
    Aspects.of(fargateVpc).add(new ConditionAspect(createFargateVpcResourcesCondition));

    const fargateSubnetA = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.vpc.publicSubnets[0].subnetId,
      existingSubnetA.valueAsString
    ).toString();

    const fargateSubnetB = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.vpc.publicSubnets[1].subnetId,
      existingSubnetB.valueAsString
    ).toString();

    // ECS Fargate resources
    const fargateResources = new ECSResourcesConstruct(this, "DLTRegionalFargate", {
      fargateVpc: fargateVpc.vpc,
      securityGroupEgress: egressCidrBlock.valueAsString,
      scenariosS3Bucket: scenariosBucket.toString(),
      solutionId: props.solution.id,
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

    Aspects.of(solutionsMetrics).add(new ConditionAspect(sendAnonymizedUsageCondition));

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
}
