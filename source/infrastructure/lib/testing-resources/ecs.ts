// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource, Tags, Fn } from "aws-cdk-lib";
import { ContainerImage, FargateTaskDefinition, LogDriver, CfnCluster } from "aws-cdk-lib/aws-ecs";
import { Effect, ServicePrincipal, Role, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnSecurityGroup, CfnSecurityGroupEgress, CfnSecurityGroupIngress } from "aws-cdk-lib/aws-ec2";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

export interface ECSResourcesConstructProps {
  readonly fargateVpcId: string;
  readonly scenariosS3Bucket: string;
  readonly securityGroupEgress: string;
  readonly solutionId: string;
  readonly stableTagCondition: string;
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
  public taskDefinitionFamily: string;

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
      inlinePolicies: {
        ECSTaskExecutionPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              resources: ["*"],
            }),
          ],
        }),
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
    this.taskExecutionRoleArn = dltTaskExecutionRole.roleArn;

    addCfnGuardSuppression(dltTaskExecutionRole, "IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE");
    addCfnGuardSuppression(dltTaskExecutionRole, "IAM_NO_INLINE_POLICY_CHECK");

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
    Tags.of(this.ecsCloudWatchLogGroup).add("SolutionId", props.solutionId);

    const dltTaskDefinition = new FargateTaskDefinition(this, "DLTTaskDefinition", {
      cpu: 2048,
      memoryLimitMiB: 4096,
      executionRole: dltTaskExecutionRole,
      taskRole: dltTaskExecutionRole,
    });
    const dockerRepoName = "distributed-load-testing-on-aws-load-tester";

    const versionTagForImage: string =
      process.env.PUBLIC_ECR_REGISTRY && process.env.PUBLIC_ECR_TAG
        ? `${process.env.PUBLIC_ECR_REGISTRY}/${dockerRepoName}:${process.env.PUBLIC_ECR_TAG}`
        : "";

    const stageTagForImage: string =
      process.env.PUBLIC_ECR_REGISTRY && process.env.PUBLIC_ECR_TAG
        ? `${process.env.PUBLIC_ECR_REGISTRY}/${dockerRepoName}:${
            process.env.PUBLIC_ECR_TAG.substring(0, 4) + "_stable"
          }`
        : "";

    const imageUseTag = Fn.conditionIf(props.stableTagCondition, stageTagForImage, versionTagForImage).toString();

    const imageAsset = imageUseTag
      ? ContainerImage.fromRegistry(`${imageUseTag}`)
      : new DockerImageAsset(this, "LoadTesterImage", {
          directory: path.join(__dirname, `../../../../deployment/ecr/${dockerRepoName}`),
        });

    dltTaskDefinition.addContainer("LoadTestContainer", {
      containerName: `${Aws.STACK_NAME}-load-tester`,
      image: imageAsset instanceof DockerImageAsset ? ContainerImage.fromDockerImageAsset(imageAsset) : imageAsset,
      memoryLimitMiB: 4096,
      logging: LogDriver.awsLogs({
        streamPrefix: "load-testing",
        logGroup: this.ecsCloudWatchLogGroup,
      }),
    });
    Tags.of(dltTaskDefinition).add("SolutionId", props.solutionId);
    this.taskDefinitionArn = dltTaskDefinition.taskDefinitionArn;

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
        {
          id: "F1000",
          reason: "egress rule is specificed as its own cfn resource.",
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

    this.taskDefinitionFamily = dltTaskDefinition.family;
  }
}
