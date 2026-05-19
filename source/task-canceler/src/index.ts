// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  OperationalMetricEnvelope,
  TaskCancelEvent,
  TestCleanupEvent,
  TestExecutionInput,
  TestTaskRegionConfig,
} from "@amzn/dlt-common";
import {
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  parseSafeJson,
  sendOperationalMetric,
  TestStatus,
  getCurrentDateFormatted,
} from "@amzn/dlt-common";
import { DynamoDBClient, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  DescribeExecutionCommand,
  ExecutionStatus,
  ListExecutionsCommand,
  SFNClient,
  StopExecutionCommand,
} from "@aws-sdk/client-sfn";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const HISTORY_TABLE = getRequiredEnv("HISTORY_TABLE");
const TEST_CLEANUP_ARN = getRequiredEnv("TEST_CLEANUP_ARN");
const STATE_MACHINE_ARN = getRequiredEnv("STATE_MACHINE_ARN");
const AWS_ACCOUNT_ID = getRequiredEnv("AWS_ACCOUNT_ID");

const metricEnvelope: OperationalMetricEnvelope = {
  solutionId: SOLUTION_ID,
  uuid: UUID,
  version: VERSION,
  metricUrl: METRIC_URL,
  accountId: AWS_ACCOUNT_ID,
  metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
};

export class NoActiveExecutionError extends Error {
  constructor(testId: string) {
    super(`No active Step Functions execution found for testId: ${testId}`);
    this.name = "NoActiveExecutionError";
  }
}

/**
 * Result of finding an active step function execution for a test.
 */
interface ActiveExecutionInfo {
  readonly executionArn: string;
  readonly testRunId: string;
  readonly testTaskConfigs: readonly TestTaskRegionConfig[];
}

/**
 * Finds the active (RUNNING) Step Functions execution for a given testId.
 *
 * Lists all RUNNING executions, describes each to read the input JSON,
 * and returns the one whose `testId` matches the requested test. The
 * number of concurrent executions is small (typically 1–10), so the
 * N+1 call pattern is acceptable.
 *
 * @throws Error if no matching execution is found.
 */
export async function findActiveExecution(
  sfn: SFNClient,
  stateMachineArn: string,
  testId: string
): Promise<ActiveExecutionInfo> {
  let nextToken: string | undefined;

  do {
    const listResult = await sfn.send(
      new ListExecutionsCommand({
        stateMachineArn,
        statusFilter: ExecutionStatus.RUNNING,
        nextToken,
      })
    );

    for (const execution of listResult.executions ?? []) {
      if (!execution.executionArn) {
        continue;
      }

      const describeResult = await sfn.send(new DescribeExecutionCommand({ executionArn: execution.executionArn }));

      if (!describeResult.input) {
        continue;
      }

      try {
        const input = parseSafeJson<TestExecutionInput>(describeResult.input);
        if (input.testId !== testId) {
          continue;
        }

        return {
          executionArn: execution.executionArn,
          testRunId: input.testRunId,
          testTaskConfigs: input.testTaskConfig,
        };
      } catch {
        // Skip executions with unparseable input
        continue;
      }
    }

    nextToken = listResult.nextToken;
  } while (nextToken);

  throw new NoActiveExecutionError(testId);
}

/**
 * Task Canceler Lambda handler.
 *
 * Handles cancellation requests from the API. Queries Step Functions
 * for the active execution matching the testId, extracts testRunId
 * from the execution input, stops the execution cleanly, sets DDB
 * status to CANCELLING, and invokes test-cleanup per region with
 * finalStatus CANCELLED.
 *
 * Stopping the execution prevents the zombie SF from overwriting
 * "cancelled" with "failed" via its error paths.
 */
export async function handler(event: TaskCancelEvent): Promise<string> {
  const { testId } = event;

  const logger = createLogger({ serviceName: "task-canceler", solutionId: SOLUTION_ID, version: VERSION });
  logger.appendKeys({ testId });

  logger.info("Task canceler invoked", {
    logEvent: LogEvent.TEST_CANCEL_INITIATED,
  });

  // 1. Find active SFN execution for this testId
  const sfn = new SFNClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION })));

  let activeExecution: ActiveExecutionInfo;
  try {
    activeExecution = await findActiveExecution(sfn, STATE_MACHINE_ARN, testId);
  } catch (err) {
    if (!(err instanceof NoActiveExecutionError)) {
      throw err;
    }
    // No running execution found — the test was cancelled before the SFN
    // execution started or while it was still provisioning. Set status
    // directly to CANCELLED since there is nothing to stop or clean up.
    logger.warn("No active execution found — setting status directly to cancelled", {
      logEvent: LogEvent.TEST_CANCEL_INITIATED,
    });

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: "SET #s = :s",
          ConditionExpression: "#s = :expected",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":s": TestStatus.CANCELLED,
            ":expected": TestStatus.CANCELLING,
          },
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        logger.info("Status already moved to a terminal state — skipping cancel");
      } else {
        throw err;
      }
    }

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.TestCancel,
      TestId: testId,
    });

    return "cancellation completed (no active execution)";
  }

  const { executionArn, testRunId, testTaskConfigs } = activeExecution;

  logger.appendKeys({ testRunId });
  logger.info("Found active execution", {
    executionArn,
    regionCount: testTaskConfigs.length,
  });

  // 2. Stop the SF execution to prevent zombie status overwrites
  await sfn.send(
    new StopExecutionCommand({
      executionArn,
      cause: "User cancelled via API",
    })
  );

  logger.info("Step function execution stopped", { executionArn });

  // 3. Set DDB status to CANCELLING
  const scenarioResult = await ddb.send(
    new UpdateCommand({
      TableName: SCENARIOS_TABLE,
      Key: { testId },
      UpdateExpression: "SET #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": TestStatus.CANCELLING },
      ReturnValues: "ALL_NEW",
    })
  );

  logger.info("Status set to cancelling");

  // 4. Create history entry for the cancelled test run
  const scenario = scenarioResult.Attributes;
  const now = getCurrentDateFormatted();
  let testScenario = {};
  try {
    testScenario = JSON.parse(scenario?.["testScenario"]);
  } catch {
    console.log(`Invalid JSON found in testScenario config for testId=${testId}`);
  }

  try {
    await ddb.send(
      new PutCommand({
        TableName: HISTORY_TABLE,
        Item: {
          testId,
          testRunId,
          startTime: scenario?.["startTime"] ?? now,
          endTime: now,
          status: TestStatus.CANCELLING,
          testTaskConfigs: [...testTaskConfigs],
          testType: scenario?.["testType"],
          testScenario,
          testDescription: scenario?.["testDescription"],
          scheduleTimezone: (scenario?.["scheduleTimezone"] as string | undefined) ?? "UTC",
        },
      })
    );
    logger.info("History entry created for cancelled test run"); 
  } catch (error) {
    logger.error("Failed to create history entry for cancelled test run", { testId, testRunId, error });
  }

  // 5. Emit TestCancel operational metric
  await sendOperationalMetric(metricEnvelope, {
    Type: OperationalMetricEvent.TestCancel,
    TestId: testId,
    TestRunId: testRunId,
    RegionCount: testTaskConfigs.length,
  });

  // 6. Invoke test-cleanup per region (async, fire-and-forget)
  const lambda = new LambdaClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));

  for (const regionConfig of testTaskConfigs) {
    const cleanupEvent: TestCleanupEvent = {
      testId,
      testRunId,
      testTaskConfig: regionConfig,
      finalStatus: TestStatus.CANCELLED,
    };

    try {
      await lambda.send(
        new InvokeCommand({
          FunctionName: TEST_CLEANUP_ARN,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify(cleanupEvent)),
        })
      );
      logger.info("Invoked test-cleanup for region", { region: regionConfig.region });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to invoke test-cleanup for region — continuing", {
        region: regionConfig.region,
        error: message,
      });
    }
  }

  return "cancellation initiated";
}
