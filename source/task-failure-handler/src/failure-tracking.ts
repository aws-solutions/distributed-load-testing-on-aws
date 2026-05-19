// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Atomic failure counter increment and threshold checking in DynamoDB.
 *
 * When an ECS task fails, this module:
 * 1. Atomically increments taskFailureCount using a conditional update
 * 2. Reads back the current state (status, desiredCount, healthyThreshold)
 * 3. Computes whether the healthy task percentage has breached the threshold
 */

import type { Logger } from "@amzn/dlt-common";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * DDB scenario record shape — the fields relevant to failure tracking.
 * We own this table; these fields are written at test creation time.
 *
 * The DocumentClient doesn't support generics on return types, so we
 * define the expected shape here and cast once at the DDB boundary.
 */
interface ScenarioRecord {
  readonly taskFailureCount: number;
  readonly desiredTaskCount: number;
  readonly healthyThreshold: number;
  readonly status: string;
  readonly testRunId: string;
}

/** Fields returned to the caller after incrementing */
export interface FailureIncrementResult {
  readonly taskFailureCount: number;
  readonly desiredCount: number;
  readonly healthyThreshold: number;
  readonly status: string;
  readonly testRunId: string;
}

/** Parameters for incrementFailureCount */
export interface IncrementFailureParams {
  readonly ddb: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly testId: string;
  readonly logger: Logger;
}

/**
 * Atomically increments the task failure counter in DynamoDB and returns
 * the updated record fields needed for threshold evaluation.
 *
 * Uses `SET taskFailureCount = if_not_exists(taskFailureCount, :zero) + :one`
 * so the counter works even if the field doesn't exist yet.
 * Returns ALL_NEW so we get the post-update snapshot in one round trip.
 */
export async function incrementFailureCount(params: IncrementFailureParams): Promise<FailureIncrementResult> {
  const { ddb, tableName, testId, logger } = params;

  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { testId },
      UpdateExpression: "ADD taskFailureCount :one",
      ConditionExpression: "attribute_exists(testId)",
      ExpressionAttributeValues: {
        ":one": 1,
      },
      ReturnValues: "ALL_NEW",
      ReturnValuesOnConditionCheckFailure: "ALL_OLD",
    })
  );

  if (!result.Attributes) {
    throw new Error(`DynamoDB returned no attributes for testId=${testId}`);
  }

  // Single cast at the DDB boundary — we own this table schema
  const record = result.Attributes as unknown as ScenarioRecord;

  logger.info("Failure counter incremented", {
    testId,
    taskFailureCount: record.taskFailureCount,
    desiredCount: record.desiredTaskCount,
    healthyThreshold: record.healthyThreshold,
    status: record.status,
  });

  return {
    taskFailureCount: record.taskFailureCount,
    desiredCount: record.desiredTaskCount,
    healthyThreshold: record.healthyThreshold,
    status: record.status,
    testRunId: record.testRunId,
  };
}

/**
 * Determines whether the healthy task percentage has dropped below the threshold.
 *
 * healthy% = ((desiredCount - taskFailureCount) / desiredCount) * 100
 *
 * Returns true if healthy% < healthyThreshold (i.e., too many failures).
 * Returns false if desiredCount is 0 (avoid division by zero).
 */
export function isThresholdBreached(failureCount: number, desiredCount: number, healthyThreshold: number): boolean {
  if (desiredCount <= 0) {
    return false;
  }
  const healthyPercent = ((desiredCount - failureCount) / desiredCount) * 100;
  return healthyPercent < healthyThreshold;
}
