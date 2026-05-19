// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { OperationalMetricEnvelope, TestCleanupEvent } from "@amzn/dlt-common";
import {
  buildServiceName,
  buildTaskDefinitionFamily,
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
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { deleteMetricFilters, publishMetricFilterCount } from "./metric-cleanup.js";
import { drainAndDeleteService } from "./service-cleanup.js";
import { cleanupTaskDefinitions } from "./task-definition-cleanup.js";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const HISTORY_TABLE = getRequiredEnv("HISTORY_TABLE");
const AWS_ACCOUNT_ID = getRequiredEnv("AWS_ACCOUNT_ID");

const metricEnvelope: OperationalMetricEnvelope = {
  solutionId: SOLUTION_ID,
  uuid: UUID,
  version: VERSION,
  metricUrl: METRIC_URL,
  accountId: AWS_ACCOUNT_ID,
  metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION })));

/**
 * Test Cleanup Lambda handler.
 *
 * Cleans up all ECS resources created for a load test in one region,
 * then sets the final DDB test status. Invoked from:
 *   - Step function Catch states (finalStatus: FAILED)
 *   - Step function Phase 3 cleanup map (finalStatus: COMPLETE)
 *   - task-canceler (finalStatus: CANCELLED)
 *   - sfn-failure-handler (finalStatus: FAILED)
 *
 * Steps:
 * 1. Gracefully drain and delete the ECS service
 * 2. Deregister active and clean up old task definition revisions
 * 3. Delete CloudWatch metric filters
 * 4. Publish remaining metric filter count
 * 5. Set DDB status to finalStatus
 */
export async function handler(event: TestCleanupEvent): Promise<string> {
  const { testId, testRunId, testTaskConfig, finalStatus, errorReason } = event;
  const { region, taskCluster, ecsCloudWatchLogGroup } = testTaskConfig;

  const logger = createLogger({ serviceName: "test-cleanup", solutionId: SOLUTION_ID, version: VERSION });
  logger.appendKeys({ testId, region, testRunId });

  // Always derive resource names from testId + region using the shared
  // naming conventions. Callers do not provide these — single source of truth.
  const serviceName = buildServiceName(testId, region);
  const taskDefinitionFamily = buildTaskDefinitionFamily(testId);

  logger.info("Test cleanup invoked", {
    serviceName,
    taskDefinitionFamily,
    finalStatus,
    hasErrorReason: errorReason !== undefined,
  });

  const clientConfig = getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region });
  const ecs = new ECSClient(clientConfig);

  try {
    // 1. Gracefully drain and delete ECS service
    await drainAndDeleteService({ ecs, cluster: taskCluster, serviceName, logger });

    // 2. Clean up task definition revisions
    await cleanupTaskDefinitions({ ecs, family: taskDefinitionFamily, logger });

    // 3–4. Delete metric filters and publish remaining count
    const cloudwatchLogs = new CloudWatchLogsClient(clientConfig);
    const cloudwatch = new CloudWatchClient(clientConfig);

    await deleteMetricFilters({
      cloudwatchLogs,
      testId,
      taskCluster,
      ecsCloudWatchLogGroup,
      logger,
    });

    await publishMetricFilterCount({
      cloudwatch,
      cloudwatchLogs,
      ecsCloudWatchLogGroup,
      logger,
    });

    // 5. Update DynamoDB status (skipped when the SFN will handle it)
    if (!event.skipStatusUpdate) {
      await updateTestStatus(testId, finalStatus, errorReason);

      // 6. Update Test History status
      await updateTestHistoryStatus(event, finalStatus);
    } else {
      logger.info("Skipping DDB status update — skipStatusUpdate flag is set", {
        testId,
        finalStatus,
        skipStatusUpdate: true,
      });
    }

    logger.info("Test cleanup complete", {
      logEvent: LogEvent.CLEANUP_COMPLETE,
      finalStatus,
      errorReason,
    });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.CleanupComplete,
      TestId: testId,
      TestRunId: event.testRunId,
      Region: region,
      FinalStatus: finalStatus,
    });

    return finalStatus === TestStatus.FAILED ? "cleanup complete — test failed" : `cleanup complete — ${finalStatus}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Test cleanup failed", { logEvent: LogEvent.CLEANUP_FAILED, error: message });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.CleanupFailed,
      TestId: testId,
      TestRunId: event.testRunId,
      Region: region,
      Error: message,
    });

    // Best-effort DDB status update on cleanup failure
    try {
      await updateTestStatus(testId, TestStatus.FAILED, "Test cleanup encountered an error during resource cleanup.");
      await updateTestHistoryStatus(event, TestStatus.FAILED);
    } catch (ddbError: unknown) {
      const ddbMessage = ddbError instanceof Error ? ddbError.message : String(ddbError);
      logger.error("Failed to update DynamoDB status after cleanup failure", { error: ddbMessage });
    }

    throw new Error(message);
  }
}

/**
 * Updates the test status in DynamoDB. Includes errorReason when provided.
 *
 * Guards against two classes of invalid overwrites:
 *
 * 1. Terminal states (complete, cancelled, failed) are immutable — the
 *    first writer wins. Multiple concurrent cleanup invocations (task-canceler,
 *    sfn-failure-handler, SFN Catch states) race to set the final status;
 *    the ConditionExpression ensures only the first one succeeds.
 *
 * 2. The "cancelling" status is reserved for the cancel flow. Only a
 *    write of "cancelled" (from the task-canceler's cleanup) is allowed
 *    to transition out of "cancelling". This prevents the sfn-failure-handler
 *    from overwriting "cancelling" with "failed" before the canceler's
 *    cleanup has a chance to finalize as "cancelled".
 *
 * Uses if_not_exists for errorReason to preserve a more detailed message
 * already written by the task failure handler. The "Set Status: running"
 * step clears errorReason at the start of each run so stale values don't
 * leak across runs.
 */
async function updateTestStatus(testId: string, status: TestStatus, errorReason?: string): Promise<void> {
  const terminalGuard = "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled AND #s <> :failed";
  const conditionExpression = status === TestStatus.CANCELLED ? terminalGuard : `${terminalGuard} AND #s <> :cancelling`;
  const conditionValues: Record<string, string> = {
    ":complete": TestStatus.COMPLETE,
    ":cancelled": TestStatus.CANCELLED,
    ":failed": TestStatus.FAILED,
  };
  if (status !== TestStatus.CANCELLED) {
    conditionValues[":cancelling"] = TestStatus.CANCELLING;
  }

  try {
    if (errorReason !== undefined) {
      await ddb.send(
        new UpdateCommand({
          TableName: SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: "SET #s = :s, #e = if_not_exists(#e, :e)",
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: { "#s": "status", "#e": "errorReason" },
          ExpressionAttributeValues: { ":s": status, ":e": errorReason, ...conditionValues },
        })
      );
    } else {
      await ddb.send(
        new UpdateCommand({
          TableName: SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: "SET #s = :s",
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":s": status, ...conditionValues },
        })
      );
    }
  } catch (error: unknown) {
    if (error instanceof ConditionalCheckFailedException) {
      // Status is already in a protected state — nothing to do.
      return;
    }
    throw error;
  }
}

async function updateTestHistoryStatus(event: TestCleanupEvent, status: TestStatus): Promise<void> {
  const terminalGuard = "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled AND #s <> :failed";
  const conditionExpression = status === TestStatus.CANCELLED ? terminalGuard : `${terminalGuard} AND #s <> :cancelling`;
  const conditionValues: Record<string, string> = {
    ":complete": TestStatus.COMPLETE,
    ":cancelled": TestStatus.CANCELLED,
    ":failed": TestStatus.FAILED,
  };
  if (status !== TestStatus.CANCELLED) {
    conditionValues[":cancelling"] = TestStatus.CANCELLING;
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: HISTORY_TABLE,
        Key: { testId: event.testId, testRunId: event.testRunId },
        UpdateExpression: "SET #s = :s",
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": status, ...conditionValues },
      })
    );
  } catch (error: unknown) {
    if (error instanceof ConditionalCheckFailedException) {
      // Status is already in a protected state — nothing to do.
      return;
    }
    throw error;
  }
}
