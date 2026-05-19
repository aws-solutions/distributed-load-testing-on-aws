// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  OperationalMetricEnvelope,
  TaskRunnerResult,
  TestExecutionInput,
  TestTaskRegionConfig,
} from "@amzn/dlt-common";
import {
  buildServiceName,
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
  TestStatus,
} from "@amzn/dlt-common";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { createDashboard } from "./dashboard.js";
import { createEcsService } from "./service.js";
import { createTestTaskDefinition } from "./task-definition.js";

/**
 * The step function Map state iterates over testTaskConfig[], so each
 * invocation receives the top-level fields plus a single TestTaskRegionConfig
 * (not an array).
 */
interface TaskRunnerEvent extends Omit<TestExecutionInput, "testTaskConfig"> {
  readonly testTaskConfig: TestTaskRegionConfig;
}

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const SCENARIOS_BUCKET = getRequiredEnv("SCENARIOS_BUCKET");
const MAIN_STACK_REGION = getRequiredEnv("MAIN_STACK_REGION");
const AWS_ACCOUNT_ID = getRequiredEnv("AWS_ACCOUNT_ID");

const metricEnvelope: OperationalMetricEnvelope = {
  solutionId: SOLUTION_ID,
  uuid: UUID,
  version: VERSION,
  metricUrl: METRIC_URL,
  accountId: AWS_ACCOUNT_ID,
  metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
};

/**
 * Task Runner Lambda handler.
 *
 * Creates the resources needed for a load test in one region:
 * 1. Registers a test-specific ECS task definition (cloned from base)
 * 2. Creates an ephemeral ECS service with the desired task count
 * 3. Creates CloudWatch metric filters and dashboard for live monitoring
 *
 * Returns a {@link TaskRunnerResult} that feeds into the step function's
 * stabilization loop. Does NOT poll for stabilization — that is handled
 * by the step function's Wait → Stabilization Checker → Choice pattern.
 */
export async function handler(event: TaskRunnerEvent): Promise<TaskRunnerResult> {
  const { testId, testRunId, testType, fileType, showLive, testDuration, prefix, testTaskConfig, hubTaskDefinition } =
    event;
  const {
    region,
    taskCluster,
    taskCount,
    subnetA,
    subnetB,
    taskSecurityGroup,
    ecsCloudWatchLogGroup,
    taskRoleArn,
    executionRoleArn,
  } = testTaskConfig;

  const logger = createLogger({ serviceName: "task-runner", solutionId: SOLUTION_ID, version: VERSION });
  logger.appendKeys({ testId, testRunId, region });

  logger.info("Task runner invoked", { testType, taskCount, prefix });

  const spokeClientConfig = getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region });
  const spokeEcs = new ECSClient(spokeClientConfig);
  const hubEcs = new ECSClient(
    getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: MAIN_STACK_REGION })
  );

  try {
    // 1. Build environment variables for the test containers
    const envVars: Record<string, string> = {
      MAIN_STACK_REGION: MAIN_STACK_REGION,
      S3_BUCKET: SCENARIOS_BUCKET,
      TEST_ID: testId,
      TEST_RUN_ID: testRunId,
      TEST_TYPE: testType,
      FILE_TYPE: fileType,
      LIVE_DATA_ENABLED: `live=${showLive}`,
      TASK_COUNT: taskCount.toString(),
      PREFIX: prefix,
      SCRIPT: "ecslistener.py",
      TIMEOUT: "900",
    };

    // 2. Register test-specific task definition.
    // Container shape (image, cpu, memory, healthCheck, etc.) comes from the hub's
    // task definition. Roles and log configuration come from the spoke's DynamoDB config.
    const taskDefResult = await createTestTaskDefinition({
      hubEcs,
      spokeEcs,
      hubTaskDefinition,
      taskRoleArn,
      executionRoleArn,
      ecsCloudWatchLogGroup,
      region,
      testId,
      testRunId,
      envVars,
      solutionId: SOLUTION_ID,
      logger,
    });

    // 3. Create ephemeral ECS service
    const serviceName = buildServiceName(testId, region);
    const serviceResult = await createEcsService({
      ecs: spokeEcs,
      cluster: taskCluster,
      serviceName,
      taskDefinitionArn: taskDefResult.taskDefinitionArn,
      desiredCount: taskCount,
      subnets: [subnetA, subnetB],
      securityGroup: taskSecurityGroup,
      testId,
      testRunId,
      solutionId: SOLUTION_ID,
      logger,
    });

    logger.info("ECS service created", {
      logEvent: LogEvent.SERVICE_CREATED,
      serviceName: serviceResult.serviceName,
      desiredCount: taskCount,
    });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.ServiceCreated,
      TestId: testId,
      TestRunId: testRunId,
      Region: region,
      ServiceName: serviceResult.serviceName,
      DesiredCount: taskCount,
    });

    // 4. Transition DDB status from "queued" to "provisioning" now that
    // the ECS service exists. The step function's stabilization loop
    // checks health before the Start Command promotes to "running".
    const ddb = DynamoDBDocumentClient.from(
      new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }))
    );
    await ddb.send(
      new UpdateCommand({
        TableName: SCENARIOS_TABLE,
        Key: { testId },
        UpdateExpression: "SET #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": TestStatus.PROVISIONING },
      })
    );
    logger.info("Updated test status to provisioning");

    // 5. Create CloudWatch dashboard for live monitoring
    const cloudwatch = new CloudWatchClient(spokeClientConfig);
    const cloudwatchLogs = new CloudWatchLogsClient({ ...spokeClientConfig, maxAttempts: 10 });
    await createDashboard({
      cloudwatch,
      cloudwatchLogs,
      testId,
      region,
      ecsCloudWatchLogGroup,
      taskCluster,
      logger,
    });

    // 6. Return TaskRunnerResult — stabilization checked by step function
    return {
      testId,
      testRunId,
      testType,
      fileType,
      showLive,
      testDuration,
      prefix,
      testTaskConfig,
      serviceName: serviceResult.serviceName,
      serviceArn: serviceResult.serviceArn,
      taskDefinitionArn: taskDefResult.taskDefinitionArn,
      taskDefinitionFamily: taskDefResult.family,
      desiredCount: taskCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Task runner failed", { logEvent: LogEvent.TASK_RUNNER_FAILED, error: message });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.ServiceCreateFailed,
      TestId: testId,
      TestRunId: testRunId,
      Region: region,
      Error: message,
    });

    // Update DynamoDB with failure status
    try {
      const ddb = DynamoDBDocumentClient.from(
        new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }))
      );
      await ddb.send(
        new UpdateCommand({
          TableName: SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: "SET #s = :s, #e = :e",
          ExpressionAttributeNames: { "#s": "status", "#e": "errorReason" },
          ExpressionAttributeValues: { ":s": "failed", ":e": "Failed to create ECS service." },
        })
      );
    } catch (ddbError: unknown) {
      const ddbMessage = ddbError instanceof Error ? ddbError.message : String(ddbError);
      logger.error("Failed to update DynamoDB status", { error: ddbMessage });
    }

    throw new Error(message);
  }
}
