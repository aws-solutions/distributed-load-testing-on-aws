// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Input for the pre-test running check.
 *
 * Called inside the Map state (before service creation) to verify
 * the test scenario is still in "running" status in DynamoDB.
 * If the user cancelled or another error occurred, this returns
 * `isRunning: false` so the step function can skip service creation.
 */
export interface RunningCheckInput {
  readonly ddb: DynamoDBDocumentClient;
  readonly scenariosTable: string;
  readonly testId: string;
  readonly logger: Logger;
}

export interface RunningCheckResult {
  readonly isRunning: boolean;
}

/**
 * Queries DynamoDB to check whether the test scenario status is "running".
 *
 * Returns `{ isRunning: true }` only when the DynamoDB item exists and
 * its `status` field equals "running". All other cases (missing item,
 * different status, etc.) return `{ isRunning: false }`.
 */
export async function checkRunningStatus(input: RunningCheckInput): Promise<RunningCheckResult> {
  const { ddb, scenariosTable, testId, logger } = input;

  logger.info("Checking test running status", { testId, scenariosTable });

  const response = await ddb.send(
    new GetCommand({
      TableName: scenariosTable,
      Key: { testId },
      ProjectionExpression: "#s",
      ExpressionAttributeNames: { "#s": "status" },
    })
  );

  const status: unknown = response.Item?.["status"];
  const isRunning = status === "running";

  logger.info("Running check result", { testId, status: typeof status === "string" ? status : "undefined", isRunning });

  return { isRunning };
}
