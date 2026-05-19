// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionMonitoringEvent, OperationalMetricEnvelope, TestTaskRegionConfig } from "@amzn/dlt-common";
import {
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
} from "@amzn/dlt-common";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { monitorCompletion } from "./completion.js";
import { checkRunningStatus } from "./running-check.js";

/**
 * Pre-test running check event — dispatched when `serviceName` is absent.
 *
 * The step function invokes this before service creation to verify the
 * test is still in "running" status. If the user cancelled while tasks
 * were queued, this returns `isRunning: false` and the Map branch skips
 * service creation.
 */
export interface RunningCheckEvent {
  readonly testId: string;
  readonly testRunId: string;
  readonly testTaskConfig: TestTaskRegionConfig;
}

/**
 * Discriminated union: presence of `serviceName` determines which mode
 * the handler operates in.
 */
export type TaskStatusCheckerEvent = RunningCheckEvent | CompletionMonitoringEvent;

/**
 * Running check response — original event augmented with `isRunning`.
 */
export interface RunningCheckResponse extends RunningCheckEvent {
  readonly isRunning: boolean;
}

/**
 * Grace period in seconds after testDuration before declaring timeout.
 * Allows time for tasks to upload results and write completion markers
 * after the test finishes.
 */
const GRACE_PERIOD_SECONDS = 300;

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
 * Determines whether the event is a completion monitoring event
 * (has `serviceName`) vs. a running check event.
 */
function isCompletionEvent(event: TaskStatusCheckerEvent): event is CompletionMonitoringEvent {
  return "serviceName" in event;
}

/**
 * Task Status Checker Lambda handler.
 *
 * Two modes of operation:
 *
 * 1. **Running Check** (no `serviceName`): Queries DynamoDB to confirm the
 *    test scenario is still in "running" status. Returns `{ ...event, isRunning }`.
 *
 * 2. **Completion Monitoring** (has `serviceName`): Checks DDB status for
 *    early failure detection, counts S3 completion markers, and enforces a
 *    deadline of `testDuration + GRACE_PERIOD_SECONDS`.
 */
export async function handler(
  event: TaskStatusCheckerEvent
): Promise<RunningCheckResponse | CompletionMonitoringEvent> {
  const logger = createLogger({ serviceName: "task-status-checker", solutionId: SOLUTION_ID, version: VERSION });
  const testId = event.testId;
  const region = event.testTaskConfig.region;
  logger.appendKeys({ testId, testRunId: event.testRunId, region });

  try {
    if (!isCompletionEvent(event)) {
      // ── Running Check Path ──
      logger.info("Running check mode");

      const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION })));
      const { isRunning } = await checkRunningStatus({
        ddb,
        scenariosTable: SCENARIOS_TABLE,
        testId,
        logger,
      });

      return { ...event, isRunning };
    }

    // ── Completion Monitoring Path ──
    const pollStartTime = event.pollStartTime ?? Date.now();

    logger.info("Completion monitoring mode", {
      serviceName: event.serviceName,
      desiredCount: event.desiredCount,
      previousCompleted: event.completedTaskCount,
      pollStartTime,
    });

    // Build the pass-through result fields once
    const baseResult: Omit<CompletionMonitoringEvent, "completedTaskCount" | "isComplete" | "timedOut" | "pollStartTime" | "errorReason"> = {
      testId: event.testId,
      testRunId: event.testRunId,
      testType: event.testType,
      fileType: event.fileType,
      showLive: event.showLive,
      testDuration: event.testDuration,
      prefix: event.prefix,
      testTaskConfig: event.testTaskConfig,
      serviceName: event.serviceName,
      serviceArn: event.serviceArn,
      taskDefinitionArn: event.taskDefinitionArn,
      taskDefinitionFamily: event.taskDefinitionFamily,
      desiredCount: event.desiredCount,
    };

    // Check if the test has been marked as failed (e.g., task failure threshold breached)
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION })));
    const { isRunning } = await checkRunningStatus({
      ddb,
      scenariosTable: SCENARIOS_TABLE,
      testId,
      logger,
    });

    if (!isRunning) {
      logger.error("Test is no longer running — short-circuiting completion monitor", {
        logEvent: LogEvent.COMPLETION_TIMEOUT,
      });

      await sendOperationalMetric(metricEnvelope, {
        Type: OperationalMetricEvent.CompletionThresholdBreached,
        TestId: testId,
        TestRunId: event.testRunId,
        Region: region,
        CompletedTaskCount: event.completedTaskCount ?? 0,
        DesiredCount: event.desiredCount,
      }).catch((err) => logger.warn("Failed to send CompletionThresholdBreached metric", { error: err }));

      return {
        ...baseResult,
        completedTaskCount: event.completedTaskCount ?? 0,
        isComplete: false,
        timedOut: true,
        pollStartTime,
        errorReason: "Task failure threshold breached",
      };
    }

    // Count S3 completion markers
    const s3 = new S3Client(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: MAIN_STACK_REGION }));
    const { completedTaskCount, isComplete } = await monitorCompletion({
      s3,
      bucket: SCENARIOS_BUCKET,
      testId,
      prefix: event.prefix,
      region,
      desiredCount: event.desiredCount,
      logger,
    });

    // Deadline-based timeout: testDuration + grace period
    const elapsedSeconds = (Date.now() - pollStartTime) / 1000;
    const deadline = event.testDuration + GRACE_PERIOD_SECONDS;
    const timedOut = elapsedSeconds > deadline;

    if (isComplete) {
      logger.info("All tasks completed", {
        logEvent: LogEvent.REGION_COMPLETE,
        completedTaskCount,
        desiredCount: event.desiredCount,
      });

      await sendOperationalMetric(metricEnvelope, {
        Type: OperationalMetricEvent.RegionComplete,
        TestId: testId,
        TestRunId: event.testRunId,
        Region: region,
        CompletedTaskCount: completedTaskCount,
        DesiredCount: event.desiredCount,
      }).catch((err) => logger.warn("Failed to send RegionComplete metric", { error: err }));
    }

    if (timedOut && !isComplete) {
      logger.error("Completion monitoring timed out — deadline exceeded", {
        logEvent: LogEvent.COMPLETION_TIMEOUT,
        elapsedSeconds,
        deadline,
        completedTaskCount,
        desiredCount: event.desiredCount,
      });

      await sendOperationalMetric(metricEnvelope, {
        Type: OperationalMetricEvent.CompletionTimeout,
        TestId: testId,
        TestRunId: event.testRunId,
        Region: region,
        ElapsedSeconds: Math.round(elapsedSeconds),
        Deadline: deadline,
        CompletedTaskCount: completedTaskCount,
        DesiredCount: event.desiredCount,
      }).catch((err) => logger.warn("Failed to send CompletionTimeout metric", { error: err }));
    }

    const result: CompletionMonitoringEvent = {
      ...baseResult,
      completedTaskCount,
      isComplete,
      timedOut,
      pollStartTime,
      ...(timedOut && !isComplete && { errorReason: "Test execution timed out" }),
    };

    logger.info("Completion monitoring result", { completedTaskCount, isComplete, timedOut, elapsedSeconds });

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Task status checker failed", { error: message });

    // Update DynamoDB with failure status
    try {
      const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION })));
      await ddb.send(
        new UpdateCommand({
          TableName: SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: "SET #s = :s, #e = :e",
          ExpressionAttributeNames: { "#s": "status", "#e": "errorReason" },
          ExpressionAttributeValues: { ":s": "failed", ":e": "Failed to check task status." },
        })
      );
    } catch (ddbError: unknown) {
      const ddbMessage = ddbError instanceof Error ? ddbError.message : String(ddbError);
      logger.error("Failed to update DynamoDB status", { error: ddbMessage });
    }

    throw new Error(message);
  }
}
