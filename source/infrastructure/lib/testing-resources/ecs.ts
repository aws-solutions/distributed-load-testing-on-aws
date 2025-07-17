// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource, Tags } from "aws-cdk-lib";
import { Cluster, ContainerImage, FargateTaskDefinition, LogDriver, ContainerInsights } from "aws-cdk-lib/aws-ecs";
import { Effect, ServicePrincipal, Role, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";

export interface ECSResourcesConstructProps {
  readonly fargateVpc: Vpc;
  readonly scenariosS3Bucket: string;
  readonly securityGroupEgress: string;
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
  public taskDefinitionFamily: string;

  constructor(scope: Construct, id: string, props: ECSResourcesConstructProps) {
    super(scope, id);

    const dltTaskCluster = new Cluster(this, "DLTEcsCluster", {
      clusterName: Aws.STACK_NAME + "Cluster",
      containerInsightsV2: ContainerInsights.ENABLED,
      vpc: props.fargateVpc,
    });

    this.taskClusterName = dltTaskCluster.clusterName;

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
    const imageAsset =
      process.env.PUBLIC_ECR_REGISTRY && process.env.PUBLIC_ECR_TAG
        ? ContainerImage.fromRegistry(
            `${process.env.PUBLIC_ECR_REGISTRY}/${dockerRepoName}:${process.env.PUBLIC_ECR_TAG}`
          )
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

    const ecsSecurityGroup = new SecurityGroup(this, "DLTEcsSecurityGroup", {
      vpc: props.fargateVpc,
      description: "DLT Tasks Security Group",
      allowAllOutbound: true,
    });
    ecsSecurityGroup.addIngressRule(ecsSecurityGroup, Port.tcp(50000), "Allow tasks to communicate");
    ecsSecurityGroup.addEgressRule(Peer.ipv4(props.securityGroupEgress), Port.allTraffic(), "Allow outbound traffic");
    ecsSecurityGroup.node.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W40",
          reason: "IpProtocol set to -1 (any) as ports are not known prior to running tests",
        },
      ],
    });

    this.ecsSecurityGroupId = ecsSecurityGroup.securityGroupId;
    this.taskDefinitionFamily = dltTaskDefinition.family;
  }
}
