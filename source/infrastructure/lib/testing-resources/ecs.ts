// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnCondition, CfnResource, Duration, Fn, Stack, Tags } from "aws-cdk-lib";
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
  readonly loadTesterImageUri: string;
  readonly locustLoadTesterImageUri: string;
  readonly k6LoadTesterImageUri: string;
  readonly jmeterLoadTesterImageUri: string;
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
  /** Only set for hub stacks (containerMode: "hub"). */
  public locustTaskDefinitionArn: string | undefined;
  /** Only set for hub stacks (containerMode: "hub"). */
  public k6TaskDefinitionArn: string | undefined;
  /** Only set for hub stacks (containerMode: "hub"). */
  public jmeterTaskDefinitionArn: string | undefined;

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
              actions: ["s3:HeadObject", "s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:AbortMultipartUpload"],
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
      this.taskDefinitionArn = this.createTestRunnerTaskDef({
        idPrefix: "",
        dockerRepoName: "distributed-load-testing-on-aws-load-tester",
        containerSuffix: "",
        imageUri: props.loadTesterImageUri,
        stableTagCondition: props.stableTagCondition,
        buildFromSource: props.buildFromSource,
        executionRole: dltTaskExecutionRole,
        taskRole: dltTaskRole,
        solutionId: props.solutionId,
        healthCheckStartPeriod: Duration.seconds(120),
        environment: {
          JVM_ARGS: "-Xms1g -Xmx3g -XX:+ExitOnOutOfMemoryError -XX:-HeapDumpOnOutOfMemoryError",
        },
      });

      this.locustTaskDefinitionArn = this.createTestRunnerTaskDef({
        idPrefix: "Locust",
        dockerRepoName: "distributed-load-testing-on-aws-load-tester-locust",
        containerSuffix: "locust",
        imageUri: props.locustLoadTesterImageUri,
        stableTagCondition: props.stableTagCondition,
        buildFromSource: props.buildFromSource,
        executionRole: dltTaskExecutionRole,
        taskRole: dltTaskRole,
        solutionId: props.solutionId,
        // Matches k6 rather than the other frameworks: setup may pip-install the
        // custom dependencies a Locust test declares in requirements.txt, which
        // is bounded at 180s. At 120s the health check would start failing while
        // a slow install was still succeeding, and ECS would replace the task.
        healthCheckStartPeriod: Duration.seconds(180),
      });

      this.k6TaskDefinitionArn = this.createTestRunnerTaskDef({
        idPrefix: "K6",
        dockerRepoName: "distributed-load-testing-on-aws-load-tester-k6",
        containerSuffix: "k6",
        imageUri: props.k6LoadTesterImageUri,
        stableTagCondition: props.stableTagCondition,
        buildFromSource: props.buildFromSource,
        executionRole: dltTaskExecutionRole,
        taskRole: dltTaskRole,
        solutionId: props.solutionId,
        healthCheckStartPeriod: Duration.seconds(180),
      });

      this.jmeterTaskDefinitionArn = this.createTestRunnerTaskDef({
        idPrefix: "JMeter",
        dockerRepoName: "distributed-load-testing-on-aws-load-tester-jmeter",
        containerSuffix: "jmeter",
        imageUri: props.jmeterLoadTesterImageUri,
        stableTagCondition: props.stableTagCondition,
        buildFromSource: props.buildFromSource,
        executionRole: dltTaskExecutionRole,
        taskRole: dltTaskRole,
        solutionId: props.solutionId,
        environment: {
          JVM_ARGS: "-Xms1g -Xmx3g -XX:+ExitOnOutOfMemoryError -XX:-HeapDumpOnOutOfMemoryError",
        },
        healthCheckStartPeriod: Duration.seconds(120),
      });
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

  private createTestRunnerTaskDef(input: {
    idPrefix: "" | "K6" | "Locust" | "JMeter";
    dockerRepoName: string;
    containerSuffix: "" | "k6" | "locust" | "jmeter";
    imageUri: string;
    stableTagCondition: string;
    buildFromSource: boolean;
    executionRole: Role;
    taskRole: Role;
    solutionId: string;
    environment?: Record<string, string>;
    healthCheckStartPeriod: Duration;
  }): string {
    const taskDefinition = new FargateTaskDefinition(this, `${input.idPrefix}DLTTaskDefinition`, {
      cpu: 2048,
      memoryLimitMiB: 4096,
      executionRole: input.executionRole,
      taskRole: input.taskRole,
    });

    const versionTagForImage =
      process.env.PUBLIC_ECR_REGISTRY && process.env.PUBLIC_ECR_TAG
        ? `${process.env.PUBLIC_ECR_REGISTRY}/${input.dockerRepoName}:${process.env.PUBLIC_ECR_TAG}`
        : "";
    const stableTagForImage =
      process.env.PUBLIC_ECR_REGISTRY && process.env.PUBLIC_ECR_TAG
        ? `${process.env.PUBLIC_ECR_REGISTRY}/${input.dockerRepoName}:${
            process.env.PUBLIC_ECR_TAG.substring(0, 4) + "_stable"
          }`
        : "";

    const usePublicImageCondition = new CfnCondition(
      Stack.of(this),
      `UsePublic${input.idPrefix}LoadTestingImageCondition`,
      {
        expression: Fn.conditionEquals(input.imageUri, ""),
      }
    );
    const publicImage = Fn.conditionIf(input.stableTagCondition, stableTagForImage, versionTagForImage).toString();
    const imageChoice = Fn.conditionIf(usePublicImageCondition.logicalId, publicImage, input.imageUri).toString();

    const image = input.buildFromSource
      ? ContainerImage.fromDockerImageAsset(
          new DockerImageAsset(this, `${input.idPrefix}LoadTesterImage`, {
            directory: path.join(__dirname, `../../../../deployment/ecr/${input.dockerRepoName}`),
            platform: Platform.LINUX_AMD64,
          })
        )
      : ContainerImage.fromRegistry(imageChoice);

    const containerSuffix = input.containerSuffix ? `-${input.containerSuffix}` : "";
    taskDefinition.addContainer(`${input.idPrefix}LoadTestContainer`, {
      containerName: `${Aws.STACK_NAME}-load-tester${containerSuffix}`,
      image,
      memoryLimitMiB: 4096,
      stopTimeout: Duration.seconds(120), // max duration for Fargate tasks
      logging: LogDriver.awsLogs({
        streamPrefix: "load-testing",
        logGroup: this.ecsCloudWatchLogGroup,
      }),
      environment: input.environment,
      healthCheck: {
        command: ["CMD-SHELL", "test -f /tmp/health_ready || exit 1"],
        interval: Duration.seconds(5),
        timeout: Duration.seconds(5),
        retries: 10,
        startPeriod: input.healthCheckStartPeriod,
      },
    });
    Tags.of(taskDefinition).add("SolutionId", input.solutionId);
    return taskDefinition.taskDefinitionArn;
  }
}
