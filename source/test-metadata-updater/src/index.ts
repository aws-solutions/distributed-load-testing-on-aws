// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  formatDate,
  getAwsClientConfig,
  getRequiredEnv,
  incrementTestRunCount,
  type NativeRunMode,
  parseSafeJson,
  TestStatus,
} from "@amzn/dlt-common";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const HISTORY_TABLE = getRequiredEnv("HISTORY_TABLE");

export interface TestMetadataUpdateEvent {
  readonly testId: string;
  readonly testRunId: string;
  readonly status?: TestStatus;
  readonly endTime?: string;
  readonly errorReason?: string;
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
  readonly errorReason?: string;
  readonly nativeRunMode?: NativeRunMode;
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

  // A failure can be recorded directly on the scenario by a proximate writer
  // (e.g. the Task Failure Handler on a healthy-threshold breach) without that
  // reason reaching this terminal write via $.errorReason — it is stripped at
  // the Execution Map boundary in the step function. When the event carries no
  // reason, fall back to the reason already on the scenario so the run/history
  // record shows the same cause instead of nothing. Safe because errorReason is
  // cleared when a run starts (the `queued` transition removes it), so any value
  // present here belongs to the current run, not a previous one.
  const effectiveErrorReason = event.errorReason || testScenario.errorReason;
  const effectiveEvent: TestMetadataUpdateEvent = effectiveErrorReason
    ? { ...event, errorReason: effectiveErrorReason }
    : event;

  await updateTestScenarioStatus(effectiveEvent);
  console.log("Updated Test Scenario");
  await updateTestHistoryStatus(effectiveEvent, testScenario);
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
/**
 * Sends an UpdateCommand, treating a failed ConditionExpression as a no-op: the
 * guarded precondition was not met (the scenario is already terminal, or it was
 * deleted), so there is nothing to do. Any other error propagates.
 */
async function sendIgnoringFailedCondition(command: UpdateCommand): Promise<void> {
  try {
    await ddb.send(command);
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) {
      throw error;
    }
  }
}

/**
 * Builds the guarded scenario status/endTime UpdateCommand. The terminal-state
 * guard is applied only when a status is being written, so terminal states stay
 * immutable while an endTime-only update is unconditional.
 */
function buildScenarioStatusUpdate(testId: string, status?: TestStatus, endTime?: string): UpdateCommand {
  const updateList: string[] = [];
  const ExpressionAttributeNames: Record<string, string> = {};
  const ExpressionAttributeValues: Record<string, string> = {};
  let terminalGuard: string | undefined;

  if (status) {
    terminalGuard = "#s <> :complete AND #s <> :cancelled AND #s <> :failed";
    updateList.push("#s = :s");
    ExpressionAttributeNames["#s"] = "status";
    ExpressionAttributeValues[":s"] = status;
    ExpressionAttributeValues[":complete"] = TestStatus.COMPLETE;
    ExpressionAttributeValues[":cancelled"] = TestStatus.CANCELLED;
    ExpressionAttributeValues[":failed"] = TestStatus.FAILED;
  }
  if (endTime) {
    updateList.push("endTime = :endTime");
    ExpressionAttributeValues[":endTime"] = formatDate(new Date(endTime));
  }

  return new UpdateCommand({
    TableName: SCENARIOS_TABLE,
    Key: { testId },
    ConditionExpression: terminalGuard,
    UpdateExpression: `SET ${updateList.join(", ")}`,
    ExpressionAttributeNames: Object.keys(ExpressionAttributeNames).length ? ExpressionAttributeNames : undefined,
    ExpressionAttributeValues,
  });
}

async function updateTestScenarioStatus({
  testId,
  status,
  endTime,
  errorReason,
}: TestMetadataUpdateEvent): Promise<void> {
  // 1. Status/endTime — guarded so terminal states (complete/cancelled/failed)
  //    are immutable. Skipped once the scenario is terminal (e.g. the Task Runner
  //    already marked it `failed` for a fast-fail signal); a failed guard here is
  //    a no-op, so the errorReason below is still recorded.
  if (status || endTime) {
    await sendIgnoringFailedCondition(buildScenarioStatusUpdate(testId, status, endTime));
  }

  // 2. errorReason — written separately from the status/endTime guard so it can
  //    still land when that guard is a no-op: the Task Runner's fast-fail path
  //    marks the scenario `failed` before this terminal write, so the status
  //    update above is rejected while the reason still needs to attach. The write
  //    is guarded so it never touches a `complete` or `cancelled` scenario —
  //    those are successful/deliberate terminal outcomes, and stapling a failure
  //    reason onto them (e.g. a late FAILED event reaching a healthy COMPLETE run)
  //    would break the terminal-immutability invariant. `failed` is intentionally
  //    excluded from the guard so the fast-fail reason lands. attribute_exists(testId)
  //    still prevents resurrecting a scenario deleted between the failure and this
  //    write. errorReason has a single writer (this terminal write), so overwriting
  //    keeps the scenario reason identical to the run/history record.
  if (errorReason) {
    await sendIgnoringFailedCondition(
      new UpdateCommand({
        TableName: SCENARIOS_TABLE,
        Key: { testId },
        UpdateExpression: "SET #e = :e",
        ConditionExpression: "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled",
        ExpressionAttributeNames: { "#e": "errorReason", "#s": "status" },
        ExpressionAttributeValues: {
          ":e": errorReason,
          ":complete": TestStatus.COMPLETE,
          ":cancelled": TestStatus.CANCELLED,
        },
      })
    );
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
  { testRunId, status, endTime, errorReason }: TestMetadataUpdateEvent,
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
    const ExpressionAttributeNames: Record<string, string> = {};
    if (scenario.nativeRunMode) {
      // Add native mode attributes to the history table's record
      updateList.push("nativeRunMode = if_not_exists(nativeRunMode, :nativeRunMode)");
      ExpressionAttributeValues[":nativeRunMode"] = scenario.nativeRunMode;
    }

    // Update status, start, and end time field if present
    if (status) {
      terminalGuard = "#s <> :complete AND #s <> :cancelled AND #s <> :failed";
      const conditionValues: Record<string, string> = {
        ":complete": TestStatus.COMPLETE,
        ":cancelled": TestStatus.CANCELLED,
        ":failed": TestStatus.FAILED,
      };
      updateList.push("#s = :s");
      ExpressionAttributeNames["#s"] = "status";
      ExpressionAttributeValues[":s"] = status;
      Object.assign(ExpressionAttributeValues, conditionValues);
    }
    if (endTime) {
      updateList.push("endTime = if_not_exists(endTime, :endTime)");
      ExpressionAttributeValues[":endTime"] = formatDate(new Date(endTime));
    }
    if (errorReason) {
      updateList.push("#e = if_not_exists(#e, :e)");
      ExpressionAttributeNames["#e"] = "errorReason";
      ExpressionAttributeValues[":e"] = errorReason;
    }

    const result = await ddb.send(
      new UpdateCommand({
        TableName: HISTORY_TABLE,
        Key: { testId: scenario.testId, testRunId },
        UpdateExpression: `SET ${updateList.join(", ")}`,
        ConditionExpression: terminalGuard,
        ExpressionAttributeNames: Object.keys(ExpressionAttributeNames).length ? ExpressionAttributeNames : undefined,
        ExpressionAttributeValues,
        ReturnValues: "ALL_OLD",
      })
    );

    if (!result.Attributes) {
      await incrementTestRunCount(ddb, SCENARIOS_TABLE, scenario.testId!);
    }
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Status is already in a protected state — nothing to do.
      return;
    }
    throw error;
  }
}
