// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

export async function incrementTestRunCount(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  testId: string,
  count = 1
): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { testId },
        UpdateExpression: "ADD totalTestRuns :inc",
        ExpressionAttributeValues: { ":inc": count },
        ConditionExpression: "attribute_exists(testId)",
      })
    );
  } catch (error) {
    console.error(`Failed to increment totalTestRuns for testId ${testId}:`, error);
  }
}

export async function decrementTestRunCount(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  testId: string,
  count = 1
): Promise<void> {
  return incrementTestRunCount(ddb, tableName, testId, -count);
}
