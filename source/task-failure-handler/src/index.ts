// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { OperationalMetricEnvelope } from "@amzn/dlt-common";
import {
  classifyStopCode,
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
} from "@amzn/dlt-common";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type { ECSTaskStateChangeEvent } from "./event-parser.js";
import { extractTaskFailure } from "./event-parser.js";
import { incrementFailureCount, isThresholdBreached } from "./failure-tracking.js";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
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
 * Task Failure Handler Lambda.
 *
 * Triggered by EventBridge when an ECS task transitions to STOPPED.
 * The EventBridge rule filters for source=aws.ecs, detail-type="ECS Task State Change",
 * lastStatus=STOPPED, so we receive only stopped tasks.
 *
 * Flow:
 * 1. Parse event — extract testId/region, filter out graceful shutdowns and non-DLT services
 * 2. Classify the stop reason (OOM, infrastructure, container error, unknown)
 * 3. Increment failure counter atomically in DynamoDB
 * 4. Emit TaskFailure operational metric (product team)
 * 5. Check if healthy task percentage has breached the threshold
 * 6. If breached, update DynamoDB status to "failed" and emit TaskThresholdBreached metric
 *
 * The step function's existing polling loops detect status="failed" and route to cleanup.
 * This Lambda does NOT directly invoke the Task Canceler.
 *
 * Errors are caught and logged but NOT re-thrown — this prevents EventBridge retry storms.
 */
export async function handler(event: ECSTaskStateChangeEvent): Promise<void> {
  const logger = createLogger({ serviceName: "task-failure-handler", solutionId: SOLUTION_ID, version: VERSION });

  try {
    const taskFailure = extractTaskFailure(event);
    if (!taskFailure) {
      logger.info("Event skipped — not a DLT task failure", {
        group: event.detail.group,
      });
      return;
    }

    const { testId, region, taskArn, stoppedReason, stopCode, exitCode } = taskFailure;
    logger.appendKeys({ testId, region });

    // Resolve testRunId from DDB first so every subsequent log line includes it.
    // The ECS STOPPED event doesn't carry testRunId — only the DDB record has it.
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(getAwsClientConfig({solutionId: SOLUTION_ID, version: VERSION})));

    const result = await incrementFailureCount({
      ddb,
      tableName: SCENARIOS_TABLE,
      testId,
      logger,
    });

    logger.appendKeys({ testRunId: result.testRunId });

    const stopCategory = classifyStopCode(stopCode, exitCode);

    logger.info("Task failure detected", {
      logEvent: LogEvent.TASK_FAILURE_DETECTED,
      taskArn,
      stoppedReason,
      stopCode,
      exitCode,
      stopCategory,
    });

    // Emit per-task operational metric
    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.TaskFailure,
      TestId: testId,
      TestRunId: result.testRunId,
      Region: region,
      StopCode: stopCode,
      StopCategory: stopCategory,
      FailureCount: result.taskFailureCount,
      DesiredCount: result.desiredCount,
    });

    // Skip threshold check if test is already in a terminal state
    if (result.status !== "running") {
      logger.info("Test not running — skipping threshold check", { status: result.status });
      return;
    }

    const breached = isThresholdBreached(result.taskFailureCount, result.desiredCount, result.healthyThreshold);

    if (!breached) {
      logger.warn("Task failure recorded but threshold not breached", {
        taskFailureCount: result.taskFailureCount,
        desiredCount: result.desiredCount,
        healthyThreshold: result.healthyThreshold,
      });
      return;
    }

    // Threshold breached — signal failure via DDB status update
    logger.error("Healthy threshold breached — marking test as failed", {
      logEvent: LogEvent.TASK_THRESHOLD_BREACHED,
      taskFailureCount: result.taskFailureCount,
      desiredCount: result.desiredCount,
      healthyThreshold: result.healthyThreshold,
    });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.TaskThresholdBreached,
      TestId: testId,
      TestRunId: result.testRunId,
      Region: region,
      FailureCount: result.taskFailureCount,
      DesiredCount: result.desiredCount,
      HealthyThreshold: result.healthyThreshold,
    });

    await ddb.send(
      new UpdateCommand({
        TableName: SCENARIOS_TABLE,
        Key: { testId },
        UpdateExpression: "SET #s = :s, #e = :e",
        ConditionExpression: "attribute_exists(testId) AND #s = :running",
        ExpressionAttributeNames: { "#s": "status", "#e": "errorReason" },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": `Task failure threshold breached: ${result.taskFailureCount}/${result.desiredCount} tasks failed (healthy threshold: ${result.healthyThreshold}%)`,
          ":running": "running",
        },
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      })
    );

    logger.info("Test status updated to failed");
  } catch (error: unknown) {
    // Log but do NOT re-throw — prevents EventBridge retry storms
    if (error instanceof ConditionalCheckFailedException && !(error as ConditionalCheckFailedException).Item) {
      // DynamoDB updates contain "attribute_exists(testId)" to ensure we update an existing item but prevent
      // creating a new item if it didn't exist (i.e., was already deleted).
      // We use `ReturnValuesOnConditionCheckFailure: "ALL_OLD"` to ensure we get the existing state of the
      // item before we attempted to update it. So, if `ConditionalCheckFailedException.Item` is undefined,
      // we know the item didn't exist in the tabel (i.e., didn't fail due to another condition).
      logger.error("Test has already been deleted");
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Task failure handler error", { error: message });
  }
}
