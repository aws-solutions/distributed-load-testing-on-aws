// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createLogger, getAwsClientConfig, getRequiredEnv, LogEvent, TestStatus } from "@amzn/dlt-common";
import { InvocationType, InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DescribeExecutionCommand, type ExecutionStatus, SFNClient } from "@aws-sdk/client-sfn";

import { buildCleanupEvents, parseExecutionInput } from "./execution-parser.js";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const TEST_CLEANUP_ARN = getRequiredEnv("TEST_CLEANUP_ARN");

/**
 * EventBridge event shape for Step Functions Execution Status Change.
 *
 * The EventBridge rule filters to non-SUCCEEDED statuses so only
 * FAILED, TIMED_OUT, and ABORTED executions reach this handler.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html
 */
interface SFNExecutionStatusChangeEvent {
  readonly source: "aws.states";
  readonly "detail-type": "Step Functions Execution Status Change";
  readonly detail: {
    readonly executionArn: string;
    readonly stateMachineArn: string;
    readonly status: ExecutionStatus;
  };
}

/**
 * SFN Failure Handler Lambda.
 *
 * Layer 2 safety mechanism: triggered by EventBridge when the task
 * orchestration step function exits with a non-success status. Parses
 * the execution input to extract per-region service information, then
 * invokes test-cleanup for each region with finalStatus FAILED to
 * ensure ECS service cleanup.
 *
 * Errors are caught and logged but never re-thrown to prevent
 * EventBridge retry storms.
 */
export async function handler(event: SFNExecutionStatusChangeEvent): Promise<void> {
  const logger = createLogger({ serviceName: "sfn-failure-handler", solutionId: SOLUTION_ID, version: VERSION });

  const { executionArn, status } = event.detail;
  logger.info("Step function failure detected", { logEvent: LogEvent.SFN_FAILURE_DETECTED, executionArn, status });

  try {
    const sfn = new SFNClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));

    const describeResponse = await sfn.send(new DescribeExecutionCommand({ executionArn }));

    let testStatus = TestStatus.FAILED;
    if (status === "ABORTED") {
      // The SFN failure instance was caused by manual test cancellation.
      // Should not mark test as failed in this instance
      logger.info("Cancellation request received")
      testStatus = TestStatus.CANCELLED;
    }
    const inputJson = describeResponse.input;
    if (!inputJson) {
      logger.warn("DescribeExecution returned no input", { executionArn });
      return;
    }

    const executionInput = parseExecutionInput(inputJson);
    logger.appendKeys({ testId: executionInput.testId, testRunId: executionInput.testRunId });

    const cleanupEvents = buildCleanupEvents(executionInput, testStatus);

    logger.info("Invoking test-cleanup for each region", {
      regionCount: cleanupEvents.length,
    });

    const lambda = new LambdaClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));

    await Promise.all(
      cleanupEvents.map(async (regionEvent) => {
        const region = regionEvent.testTaskConfig.region;
        try {
          await lambda.send(
            new InvokeCommand({
              FunctionName: TEST_CLEANUP_ARN,
              InvocationType: InvocationType.Event,
              Payload: new TextEncoder().encode(JSON.stringify(regionEvent)),
            })
          );
          logger.info("Test cleanup invoked for region", { region });
        } catch (invokeError: unknown) {
          const message = invokeError instanceof Error ? invokeError.message : String(invokeError);
          logger.error("Failed to invoke test-cleanup for region", { region, error: message });
        }
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("SFN failure handler encountered an error", { error: message, executionArn });
  }
}
