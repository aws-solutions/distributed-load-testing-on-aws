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

/** Root segment of the awslogs stream prefix for load-test containers. */
export const LIVE_DATA_LOG_STREAM_PREFIX = "load-testing";

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
 * Builds the awslogs stream prefix for a load test's containers.
 *
 * Format: `load-testing/{testId}`
 *
 * The awslogs driver names each stream `{prefix}/{containerName}/{ecsTaskId}`,
 * so the resulting stream name is `load-testing/{testId}/{containerName}/{ecsTaskId}`.
 * Embedding the testId lets the real-time-data-publisher derive an
 * infrastructure-controlled test identity from the CloudWatch log stream name
 * rather than trusting the (customer-writable) log line content. testId is
 * validated `^[a-zA-Z0-9-]+$`, so it contains no `/` and parses back
 * unambiguously via {@link parseTestIdFromLogStream}.
 */
export function buildLiveDataStreamPrefix(testId: string): string {
  return `${LIVE_DATA_LOG_STREAM_PREFIX}/${testId}`;
}

/**
 * Extracts the testId from a CloudWatch log stream name produced under
 * {@link buildLiveDataStreamPrefix} (`load-testing/{testId}/{container}/{taskId}`).
 *
 * Requires the full three-segment awslogs shape so the legacy two-segment prefix
 * (`load-testing/{container}/{taskId}`, used before this testId was embedded)
 * does not resolve its container name as a testId. Returns undefined when the
 * stream name does not match, so the caller can fail closed rather than publish
 * to an attacker-influenced or ambiguous topic.
 */
export function parseTestIdFromLogStream(logStream: string): string | undefined {
  const match = /^load-testing\/([a-zA-Z0-9-]+)\/[^/]+\/[^/]+$/.exec(logStream);
  return match?.[1];
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
