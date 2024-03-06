// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ArnFormat, Aws, Stack } from "aws-cdk-lib";
import { Effect, Policy, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * RegionalPermissionsConstruct props
 *
 * @interface RegionalPermissionsConstructProps
 */
export interface RegionalPermissionsConstructProps {
  apiServicesLambdaRoleName: string;
  readonly ecsCloudWatchLogGroupArn: string;
  resultsParserRoleName: string;
  readonly taskExecutionRoleArn: string;
  taskRunnerRoleName: string;
  taskCancelerRoleName: string;
  taskStatusCheckerRoleName: string;
}

/**
 * Distributed Load Testing on AWS regional permissions construct.
 * Adds the necessary permissions for the regional tests running in Fargate
 * to already existing roles attached to Lambda functions in the main stack.
 */
export class RegionalPermissionsConstruct extends Construct {
  constructor(scope: Construct, id: string, props: RegionalPermissionsConstructProps) {
    super(scope, id);

    const taskArn = Stack.of(this).formatArn({
      service: "ecs",
      resource: "task",
      resourceName: "*",
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
    const taskDefArn = Stack.of(this).formatArn({ service: "ecs", resource: "task-definition", resourceName: "*:*" });
    const apiServicesLambdaRoleArn = Stack.of(this).formatArn({
      service: "iam",
      resource: "role",
      resourceName: props.apiServicesLambdaRoleName,
    });
    const lambdaTaskRoleArn = Stack.of(this).formatArn({
      service: "iam",
      resource: "role",
      resourceName: props.taskRunnerRoleName,
    });
    const taskCancelerRoleArn = Stack.of(this).formatArn({
      service: "iam",
      resource: "role",
      resourceName: props.taskCancelerRoleName,
    });
    const taskStatusCheckerRoleArn = Stack.of(this).formatArn({
      service: "iam",
      resource: "role",
      resourceName: props.taskStatusCheckerRoleName,
    });
    const resultsParserRoleNameArn = Stack.of(this).formatArn({
      service: "iam",
      resource: "role",
      resourceName: props.resultsParserRoleName,
    });

    const ecsPolicyName = `RegionalECRPerms-${Aws.STACK_NAME}-${Aws.REGION}`;
    const ecsRegionPolicy = new Policy(this, "RegionalECRPerms", {
      policyName: ecsPolicyName,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ecs:RunTask", "ecs:DescribeTasks", "ecs:TagResource"],
          resources: [taskArn, taskDefArn],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["iam:PassRole"],
          resources: [props.taskExecutionRoleArn],
        }),
      ],
    });

    const cloudwatchPolicyName = `ECSCloudWatchPutMetrics-${Aws.STACK_NAME}-${Aws.REGION}`;
    const ecsCloudWatchPutMetricsPolicy = new Policy(this, "ECSCloudWatchPutMetricsd", {
      policyName: cloudwatchPolicyName,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["logs:PutMetricFilter"],
          resources: [props.ecsCloudWatchLogGroupArn],
        }),
      ],
    });

    const lambdaTaskRole = Role.fromRoleArn(this, "RegionalPermissionsForTaskRole", lambdaTaskRoleArn);
    lambdaTaskRole.attachInlinePolicy(ecsRegionPolicy);
    lambdaTaskRole.attachInlinePolicy(ecsCloudWatchPutMetricsPolicy);

    const cloudwatchDelName = `ECSCloudWatchDelMetrics-${Aws.STACK_NAME}-${Aws.REGION}`;
    const ecsCloudWatchDelMetricsPolicy = new Policy(this, "ECSCloudWatchDelMetrics", {
      policyName: cloudwatchDelName,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["logs:DeleteMetricFilter"],
          resources: [props.ecsCloudWatchLogGroupArn],
        }),
      ],
    });

    const apiServicesLambdaRole = Role.fromRoleArn(this, "APIServicesLambdaRole", apiServicesLambdaRoleArn);
    apiServicesLambdaRole.attachInlinePolicy(ecsRegionPolicy);
    apiServicesLambdaRole.attachInlinePolicy(ecsCloudWatchDelMetricsPolicy);

    const resultsParserLambdaRole = Role.fromRoleArn(this, "ResultsParserRole", resultsParserRoleNameArn);
    resultsParserLambdaRole.attachInlinePolicy(ecsCloudWatchDelMetricsPolicy);

    const ecsStopName = `ECSStopPolicy-${Aws.STACK_NAME}-${Aws.REGION}`;
    const ecsStopPolicy = new Policy(this, "ECSStopPolicy", {
      policyName: ecsStopName,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ecs:StopTask"],
          resources: [taskArn, taskDefArn],
        }),
      ],
    });

    const taskCancelerRole = Role.fromRoleArn(this, "TaskCancelerRole", taskCancelerRoleArn);
    taskCancelerRole.attachInlinePolicy(ecsStopPolicy);

    const ecsDescribeName = `ECSDescribePolicy${Aws.REGION}`;
    const ecsDescribePolicy = new Policy(this, "ECSDescribePolicy", {
      policyName: ecsDescribeName,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ecs:DescribeTasks"],
          resources: [taskArn],
        }),
      ],
    });

    const taskStatusCheckerRole = Role.fromRoleArn(this, "TaskStatusCheckerRole", taskStatusCheckerRoleArn);
    taskStatusCheckerRole.attachInlinePolicy(ecsDescribePolicy);
  }
}
