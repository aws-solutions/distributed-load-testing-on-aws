// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Naming conventions for DLT ECS resources.
 *
 * These functions are the single source of truth for how service names
 * and task definition families are derived from test metadata. All
 * producers (task-runner) and consumers (sfn-failure-handler, orphan-cleanup,
 * task-failure-handler) must use these functions rather than hardcoding
 * the patterns.
 */

/** Prefix used for all DLT-managed ECS service names. */
export const DLT_SERVICE_PREFIX = "dlt-";

/**
 * Builds the ECS service name for a load test in a specific region.
 *
 * Format: `dlt-{testId}-{region}`
 */
export function buildServiceName(testId: string, region: string): string {
  return `${DLT_SERVICE_PREFIX}${testId}-${region}`;
}

/**
 * Builds the ECS task definition family name for a load test.
 *
 * Format: `dlt-worker-{testId}`
 */
export function buildTaskDefinitionFamily(testId: string): string {
  return `dlt-worker-${testId}`;
}

/**
 * Builds the Step Functions execution name for a test run.
 *
 * Format: `scenario-{testId}-run-{testRunId}`
 */
export function buildExecutionName(testId: string, testRunId: string): string {
  return `scenario-${testId}-run-${testRunId}`;
}

/**
 * Extracts testId and testRunId from a Step Functions execution name.
 *
 * Execution names follow the format `scenario-{testId}-run-{testRunId}`.
 */
export function parseExecutionName(executionName: string): { testId: string; testRunId: string } {
  const match = /^scenario-(.+)-run-(.+)$/.exec(executionName);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid execution name format: ${executionName}`);
  }
  return { testId: match[1], testRunId: match[2] };
}
