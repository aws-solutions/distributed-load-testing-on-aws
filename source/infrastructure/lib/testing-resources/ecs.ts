// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource, Duration, Fn, Tags } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { CfnSecurityGroup, CfnSecurityGroupEgress } from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import { CfnCluster, ContainerImage, FargateTaskDefinition, LogDriver } from "aws-cdk-lib/aws-ecs";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

interface HubContainerProps {
  readonly containerMode: "hub";
  readonly stableTagCondition: string;
  readonly buildFromSource: boolean;
}

interface RegionalContainerProps {
  readonly containerMode: "regional";
}

interface ECSResourcesConstructBaseProps {
  readonly fargateVpcId: string;
  readonly scenariosS3Bucket: string;
  readonly securityGroupEgress: string;
  readonly solutionId: string;
}

export type ECSResourcesConstructProps = ECSResourcesConstructBaseProps & (HubContainerProps | RegionalContainerProps);

/**
 * Distributed Load Testing on AWS Fargate and ECS construct.
 *
 * Creates the ECS cluster, IAM roles, CloudWatch log group, and security group
 * for both hub and regional stacks.
 *
 * Hub stacks additionally create a FargateTaskDefinition with the load-tester
 * container image. This task definition is the single source of truth for
 * container shape — the task runner reads it at test time via DescribeTaskDefinition.
 *
 * Regional stacks do not create a task definition. The hub provides the
 * container shape at test time; the spoke only provides infrastructure
 * (cluster, roles, log group, networking).
 */
export class ECSResourcesConstruct extends Construct {
  public taskClusterName: string;
  public ecsCloudWatchLogGroup: LogGroup;
  public taskExecutionRoleArn: string;
  public taskRoleArn: string;
  public ecsSecurityGroupId: string;
  /** Only set for hub stacks (containerMode: "hub"). */
  public taskDefinitionArn: string | undefined;

  constructor(scope: Construct, id: string, props: ECSResourcesConstructProps) {
    super(scope, id);

    const dltTaskCluster = new CfnCluster(this, "DLTEcsCluster", {
      clusterName: Aws.STACK_NAME,
      clusterSettings: [{ name: "containerInsights", value: "enabled" }],
      tags: [
        { key: "SolutionId", value: props.solutionId },
        { key: "CloudFormation Stack", value: Aws.STACK_NAME },
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
      },
    });
    const dltTaskRole = new Role(this, "DLTTaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
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
    this.taskExecutionRoleArn = dltTaskExecutionRole.roleArn;
    this.taskRoleArn = dltTaskRole.roleArn;

    addCfnGuardSuppression(dltTaskExecutionRole, "IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE");
    addCfnGuardSuppression(dltTaskExecutionRole, "IAM_NO_INLINE_POLICY_CHECK");
    addCfnGuardSuppression(dltTaskRole, "IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE");
    addCfnGuardSuppression(dltTaskRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.ecsCloudWatchLogGroup = new LogGroup(this, "DLTCloudWatchLogsGroup", {
      retention: RetentionDays.TEN_YEARS,
    });
    const dltLogsGroupResource = this.ecsCloudWatchLogGroup.node.defaultChild as CfnResource;
    dltLogsGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [{ id: "W84", reason: "KMS encryption unnecessary for log group" }],
    });
    Tags.of(this.ecsCloudWatchLogGroup).add("SolutionId", props.solutionId);

    // CloudWatch alarm for metric filter count approaching limit
    const metricFilterAlarm = new Alarm(this, "MetricFilterCountAlarm", {
      alarmName: `${Aws.STACK_NAME}-MetricFilterCount-Alarm`,
      alarmDescription: "Alarm when metric filter count approaches the limit of 100",
      metric: new Metric({
        namespace: "distributed-load-testing",
        metricName: "MetricFilterCount",
        dimensionsMap: { LogGroupName: this.ecsCloudWatchLogGroup.logGroupName },
        statistic: "Maximum",
      }),
      threshold: 90,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    addCfnGuardSuppression(metricFilterAlarm, "CFN_NO_EXPLICIT_RESOURCE_NAMES");

    // Hub stacks create the task definition with the real load-tester image.
    // Regional stacks skip this — the hub provides container shape at test time.
    if (props.containerMode === "hub") {
      const dltTaskDefinition = new FargateTaskDefinition(this, "DLTTaskDefinition", {
        cpu: 2048,
        memoryLimitMiB: 4096,
        executionRole: dltTaskExecutionRole,
        taskRole: dltTaskRole,
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

      const imageTag = Fn.conditionIf(props.stableTagCondition, stageTagForImage, versionTagForImage).toString();

      const imageAsset = props.buildFromSource
        ? new DockerImageAsset(this, "LoadTesterImage", {
            directory: path.join(__dirname, `../../../../deployment/ecr/${dockerRepoName}`),
            platform: Platform.LINUX_AMD64,
          })
        : ContainerImage.fromRegistry(`${imageTag}`);

      dltTaskDefinition.addContainer("LoadTestContainer", {
        containerName: `${Aws.STACK_NAME}-load-tester`,
        image: imageAsset instanceof DockerImageAsset ? ContainerImage.fromDockerImageAsset(imageAsset) : imageAsset,
        memoryLimitMiB: 4096,
        logging: LogDriver.awsLogs({
          streamPrefix: "load-testing",
          logGroup: this.ecsCloudWatchLogGroup,
        }),
        environment: {
          JVM_ARGS: "-Xms1g -Xmx3g",
        },
        healthCheck: {
          command: ["CMD-SHELL", "test -f /tmp/health_ready || exit 1"],
          interval: Duration.seconds(5),
          timeout: Duration.seconds(5),
          retries: 10,
          startPeriod: Duration.seconds(10),
        },
      });
      Tags.of(dltTaskDefinition).add("SolutionId", props.solutionId);
      this.taskDefinitionArn = dltTaskDefinition.taskDefinitionArn;
    }

    const ecsSecurityGroup = new CfnSecurityGroup(this, "DLTEcsSecurityGroup", {
      vpcId: props.fargateVpcId,
      groupDescription: "DLTS Tasks Security Group",
    });
    ecsSecurityGroup.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W40", reason: "IpProtocol set to -1 (any) as ports are not known prior to running tests" },
        { id: "F1000", reason: "egress rule is specificed as its own cfn resource." },
      ],
    });

    this.ecsSecurityGroupId = ecsSecurityGroup.ref;

    new CfnSecurityGroupEgress(this, "DLTSecGroupEgress", {
      cidrIp: props.securityGroupEgress,
      description: "Allow tasks to call out to external resources",
      groupId: ecsSecurityGroup.ref,
      ipProtocol: "-1",
    });
  }
}
