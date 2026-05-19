// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TestCleanupEvent, TestExecutionInput } from "@amzn/dlt-common";
import { parseSafeJson, TestStatus } from "@amzn/dlt-common";

/**
 * Parses the step function execution input JSON into a typed
 * {@link TestExecutionInput}.
 *
 * DLT owns the step function input contract — the API layer constructs
 * a {@link TestExecutionInput} when starting the state machine via
 * `StartExecution`. We validate the two fields required for cleanup;
 * missing values indicate a caller bug.
 */
export function parseExecutionInput(json: string): TestExecutionInput {
  const input = parseSafeJson<TestExecutionInput>(json);

  if (!input.testId || !input.testTaskConfig.length) {
    throw new Error("Invalid execution input: missing testId or testTaskConfig");
  }

  return input;
}

/**
 * Builds a {@link TestCleanupEvent} for each region in the execution input.
 *
 * The test-cleanup Lambda derives serviceName and taskDefinitionFamily
 * from testId + region — callers do not need to provide them.
 *
 */
export function buildCleanupEvents(input: TestExecutionInput, status: TestStatus = TestStatus.FAILED): TestCleanupEvent[] {
  return input.testTaskConfig.map((regionConfig) => ({
    testId: input.testId,
    testRunId: input.testRunId,
    testTaskConfig: regionConfig,
    finalStatus: status,
    errorReason: "Step function execution failed",
  }));
}
