// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { OperationalMetricEnvelope, RegionalSyncResult, ServiceStabilizationResult, TestType } from "@amzn/dlt-common";
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
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { validateRegions } from "./sync.js";

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
 * Structured event from the step function. The SFN passes testId and
 * testRunId as top-level fields alongside the per-region results array.
 */
interface RegionalSyncEvent {
  readonly testId: string;
  readonly testRunId: string;
  readonly testType: TestType;
  readonly regions: readonly ServiceStabilizationResult[];
}

/**
 * Regional Sync Lambda handler.
 *
 * Called once after the stabilization Map state completes. Receives
 * `testId`, `testRunId`, and one {@link ServiceStabilizationResult}
 * per region, validates that all regions are READY, computes the
 * synchronization delay, and emits an operational metric.
 *
 * If any region failed stabilization, returns `allReady: false` so the
 * step function can route to cancellation for all regions.
 */
export async function handler(event: RegionalSyncEvent): Promise<RegionalSyncResult> {
  const { testId, testRunId, regions } = event;

  const logger = createLogger({ serviceName: "regional-sync", solutionId: SOLUTION_ID, version: VERSION });
  logger.appendKeys({ testId, testRunId });

  logger.info("Regional sync invoked", { regionCount: regions.length });

  try {
    const result = validateRegions(regions);

    logger.info("Regional sync result", {
      logEvent: LogEvent.REGIONAL_SYNC_COMPLETE,
      allReady: result.allReady,
      syncDelay: result.syncDelay,
      regionCount: result.regions.length,
      ...(result.failedRegions !== undefined ? { failedRegions: result.failedRegions } : {}),
    });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.RegionsReady,
      TestId: testId,
      TestRunId: testRunId,
      AllReady: result.allReady,
      SyncDelay: result.syncDelay,
      RegionCount: result.regions.length,
    });

    return result;
  } catch (error: unknown) {
    logger.error("Regional sync failed", { error });

    // Update DDB status if we have a testId from the input array.
    // The empty-array case is practically unreachable: the step function
    // Map state iterates over testTaskConfig[], which is validated to be
    // non-empty at test creation time by the API layer. An empty array
    // would require a step function misconfiguration or a bug in the
    // upstream Map state — in that scenario there is no testId to update.
    try {
      const ddbClient = new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));
      const ddb = DynamoDBDocumentClient.from(ddbClient);
      await ddb.send(
        new UpdateCommand({
          TableName: SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: "SET #s = :failed, #e = :reason",
          ExpressionAttributeNames: { "#s": "status", "#e": "errorReason" },
          ExpressionAttributeValues: {
            ":failed": "failed",
            ":reason": error instanceof Error ? error.message : "Regional sync failed",
          },
        })
      );
      logger.info("Updated test status to failed", { testId });
    } catch (ddbError: unknown) {
      logger.error("Failed to update test status in DynamoDB", { ddbError, testId });
    }

    throw error;
  }
}
