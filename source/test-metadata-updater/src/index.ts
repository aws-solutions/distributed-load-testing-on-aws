// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { getRequiredEnv, getAwsClientConfig, TestStatus, parseSafeJson, formatDate } from "@amzn/dlt-common";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const HISTORY_TABLE = getRequiredEnv("HISTORY_TABLE");

export interface TestMetadataUpdateEvent {
  readonly testId: string;
  readonly testRunId: string;
  readonly status?: TestStatus;
  readonly endTime?: string;
}

interface TestScenario {
  readonly testId?: string;
  readonly testDescription?: string;
  readonly testType?: string;
  readonly testScenario?: string;
  readonly testTaskConfigs?: object;
  readonly scheduleTimezone?: string;
  readonly startTime?: string;
  readonly status?: string;
}

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }))
);

/**
 * Updates the metadata (status and endTime)
 * of both the scenario and history records for a test execution.
 *
 * The scenario record must already exist in DynamoDB; the handler throws if it
 * does not. Both updates guard against overwriting terminal states (complete,
 * cancelled, failed) by using a DynamoDB condition expression. If the record is
 * already terminal, the update is silently skipped.
 *
 * The history record may not yet have its metadata fields populated on the first
 * invocation, so each field is written conditionally using `if_not_exists` to
 * avoid overwriting values that were set by an earlier run.
 * @param {TestMetadataUpdateEvent} event Lambda event
 */
export async function handler(event: TestMetadataUpdateEvent): Promise<void> {
  console.log(`Updating testId=${event.testId} and testRunId=${event.testRunId}`);
  console.log(`status=${event.status}, endTime=${event.endTime}`);

  // Validate that test scenario exists
  const testScenario = await getTestScenario(event);
  if (!testScenario) throw new Error(`Test Scenario object does not exist for testId=${event.testId}`);

  // Log current DDB status before updating
  console.log(`Current DDB status=${testScenario.status}`);

  await updateTestScenarioStatus(event);
  console.log("Updated Test Scenario");
  await updateTestHistoryStatus(event, testScenario);
  console.log("Updated Test History");
}

/**
 *
 * @param {string} testId testId of the scenario to retrieve
 * @returns {TestScenario | undefined} The test scenario object if exists.
 */
async function getTestScenario({ testId }: TestMetadataUpdateEvent): Promise<TestScenario | undefined> {
  const { Item } = await ddb.send(
    new GetCommand({
      TableName: SCENARIOS_TABLE,
      Key: { testId },
    })
  );
  return Item;
}

/**
 * Updates the test scenario status and optionally the endTime in DynamoDB.
 *
 * Guards against invalid overwrites:
 *
 * 1. Non-existing Test Scenario
 * 2. Terminal states (complete, cancelled, failed) are immutable
 * @param {string} testId testId of the test scenario to update
 * @param {string} status status to update the scenario to
 * @param {string?} endTime optional endTime value to update
 */
async function updateTestScenarioStatus({ testId, status, endTime }: TestMetadataUpdateEvent): Promise<void> {
  try {
    const updateList = [];
    let ExpressionAttributeNames;
    const ExpressionAttributeValues: any = {};
    let terminalGuard;

    // Update status and endTime if present
    if (status) {
      terminalGuard = "#s <> :complete AND #s <> :cancelled AND #s <> :failed";
      const conditionValues: Record<string, string> = {
        ":complete": TestStatus.COMPLETE,
        ":cancelled": TestStatus.CANCELLED,
        ":failed": TestStatus.FAILED,
      };
      updateList.push("#s = :s");
      ExpressionAttributeNames = { "#s": "status" };
      ExpressionAttributeValues[":s"] = status;
      Object.assign(ExpressionAttributeValues, conditionValues);
    }
    if (endTime) {
      updateList.push("endTime = :endTime");
      ExpressionAttributeValues[":endTime"] = formatDate(new Date(endTime));
    }
    if (!updateList.length) {
      // Do not update table entry if status and endTime not present
      return;
    }
    await ddb.send(
      new UpdateCommand({
        TableName: SCENARIOS_TABLE,
        Key: { testId },
        ConditionExpression: terminalGuard,
        UpdateExpression: `SET ${updateList.join(", ")}`,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      })
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Status is already in a protected state — nothing to do.
      return;
    }
    throw error;
  }
}

/**
 * Updates the test history status in DynamoDB.
 *
 * 1. The update guards against terminal statuses (Complete, Cancelled, and Failed)
 * 2. Updates fields other than status only when they don't exist in the table
 *    This covers the case when the history record is being created for the first time
 * @param {string} testRunId testRunId to update
 * @param {TestStatus?} status optional status to update the test history
 * @param {string?} endTime optional endTime value to update
 * @param {string} scenario testScenario object configured in scenarios table
 */
async function updateTestHistoryStatus(
  { testRunId, status, endTime }: TestMetadataUpdateEvent,
  scenario: TestScenario
): Promise<void> {
  try {
    let terminalGuard;
    const updateList = [
      "testScenario = if_not_exists(testScenario, :testScenario)",
      "testDescription = if_not_exists(testDescription, :testDescription)",
      "testType = if_not_exists(testType, :testType)",
      "testTaskConfigs = if_not_exists(testTaskConfigs, :testTaskConfigs)",
      "scheduleTimezone = if_not_exists(scheduleTimezone, :scheduleTimezone)",
      "startTime = if_not_exists(startTime, :startTime)",
    ];
    const ExpressionAttributeValues: any = {
      ":testScenario": parseSafeJson(scenario.testScenario || "{}"),
      ":testDescription": scenario.testDescription,
      ":testType": scenario.testType,
      ":testTaskConfigs": scenario.testTaskConfigs,
      ":scheduleTimezone": scenario.scheduleTimezone,
      ":startTime": scenario.startTime,
    };
    let ExpressionAttributeNames;

    // Update status, start, and end time field if present
    if (status) {
      terminalGuard = "#s <> :complete AND #s <> :cancelled AND #s <> :failed";
      const conditionValues: Record<string, string> = {
        ":complete": TestStatus.COMPLETE,
        ":cancelled": TestStatus.CANCELLED,
        ":failed": TestStatus.FAILED,
      };
      updateList.push("#s = :s");
      ExpressionAttributeNames = { "#s": "status" };
      ExpressionAttributeValues[":s"] = status;
      Object.assign(ExpressionAttributeValues, conditionValues);
    }
    if (endTime) {
      updateList.push("endTime = if_not_exists(endTime, :endTime)");
      ExpressionAttributeValues[":endTime"] = formatDate(new Date(endTime));
    }

    await ddb.send(
      new UpdateCommand({
        TableName: HISTORY_TABLE,
        Key: { testId: scenario.testId, testRunId },
        UpdateExpression: `SET ${updateList.join(", ")}`,
        ConditionExpression: terminalGuard,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      })
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Status is already in a protected state — nothing to do.
      return;
    }
    throw error;
  }
}
