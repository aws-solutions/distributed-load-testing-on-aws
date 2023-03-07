// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource } from "aws-cdk-lib";
import { CfnCluster, CfnTaskDefinition } from "aws-cdk-lib/aws-ecs";
import {
  Effect,
  ManagedPolicy,
  ServicePrincipal,
  Role,
  PolicyDocument,
  PolicyStatement,
  Policy,
} from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnSecurityGroup, CfnSecurityGroupEgress, CfnSecurityGroupIngress } from "aws-cdk-lib/aws-ec2";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface ECSResourcesConstructProps {
  readonly cloudWatchLogsPolicy: Policy;
  // Container image
  readonly containerImage: string;
  // Fargate VPC ID
  readonly fargateVpcId: string;
  // Scenarios S3 bucket
  readonly scenariosS3Bucket: string;
  // IP CIDR for Fargate egress
  readonly securityGroupEgress: string;
  // Solution ID
  readonly solutionId: string;
}

/**
 * Distributed Load Testing on AWS Fargate and ECS test runner construct.
 * This creates the ECS cluster, Fargate task definition, and Security Group
 */
export class ECSResourcesConstruct extends Construct {
  public taskClusterName: string;
  public ecsCloudWatchLogGroup: LogGroup;
  public taskDefinitionArn: string;
  public taskExecutionRoleArn: string;
  public ecsSecurityGroupId: string;

  constructor(scope: Construct, id: string, props: ECSResourcesConstructProps) {
    super(scope, id);

    const dltTaskCluster = new CfnCluster(this, "DLTEcsCluster", {
      clusterName: Aws.STACK_NAME,
      clusterSettings: [{ name: "containerInsights", value: "enabled" }],
      tags: [
        {
          key: "SolutionId",
          value: props.solutionId,
        },
        {
          key: "CloudFormation Stack",
          value: Aws.STACK_NAME,
        },
      ],
    });

    this.taskClusterName = dltTaskCluster.ref;

    const scenariosBucketArn = Bucket.fromBucketName(this, "ScenariosBucket", props.scenariosS3Bucket).bucketArn;

    const dltTaskExecutionRole = new Role(this, "DLTTaskExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
      inlinePolicies: {
        ScenariosS3Policy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:HeadObject", "s3:PutObject", "s3:GetObject", "s3:ListBucket"],
              resources: [scenariosBucketArn, `${scenariosBucketArn}/*`],
            }),
          ],
        }),
      },
    });
    dltTaskExecutionRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
    this.taskExecutionRoleArn = dltTaskExecutionRole.roleArn;

    this.ecsCloudWatchLogGroup = new LogGroup(this, "DLTCloudWatchLogsGroup", {
      retention: RetentionDays.ONE_YEAR,
    });
    const dltLogsGroupResource = this.ecsCloudWatchLogGroup.node.defaultChild as CfnResource;
    dltLogsGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W84",
          reason: "KMS encryption unnecessary for log group",
        },
      ],
    });

    const dltTaskDefinition = new CfnTaskDefinition(this, "DLTTaskDefinition", {
      cpu: "2048",
      memory: "4096",
      networkMode: "awsvpc",
      executionRoleArn: this.taskExecutionRoleArn,
      requiresCompatibilities: ["FARGATE"],
      taskRoleArn: this.taskExecutionRoleArn,
      containerDefinitions: [
        {
          essential: true,
          name: `${Aws.STACK_NAME}-load-tester`,
          image: props.containerImage,
          memory: 4096,
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": this.ecsCloudWatchLogGroup.logGroupName,
              "awslogs-stream-prefix": "load-testing",
              "awslogs-region": `${Aws.REGION}`,
            },
          },
        },
      ],
    });

    this.taskDefinitionArn = dltTaskDefinition.ref;

    const ecsSecurityGroup = new CfnSecurityGroup(this, "DLTEcsSecurityGroup", {
      vpcId: props.fargateVpcId,
      groupDescription: "DLTS Tasks Security Group",
    });
    ecsSecurityGroup.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W40",
          reason: "IpProtocol set to -1 (any) as ports are not known prior to running tests",
        },
      ],
    });

    this.ecsSecurityGroupId = ecsSecurityGroup.ref;

    new CfnSecurityGroupEgress(this, "DLTSecGroupEgress", {
      cidrIp: props.securityGroupEgress,
      description: "Allow tasks to call out to external resources",
      groupId: ecsSecurityGroup.ref,
      ipProtocol: "-1",
    });

    new CfnSecurityGroupIngress(this, "DLTSecGroupIngress", {
      description: "Allow tasks to communicate",
      fromPort: 50000,
      groupId: ecsSecurityGroup.ref,
      ipProtocol: "tcp",
      sourceSecurityGroupId: ecsSecurityGroup.ref,
      toPort: 50000,
    });
  }
}
