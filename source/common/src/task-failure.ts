// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * DynamoDB schema additions for the task failure detection system.
 *
 * When an ECS task stops unexpectedly during a load test, the Task Failure
 * Handler Lambda atomically increments a failure counter in the DynamoDB
 * scenario record and checks whether the healthy task percentage has dropped
 * below the configured threshold. If so, it invokes the Task Canceler to
 * abort the test.
 *
 * The EventBridge event shape (ECS Task State Change) is validated at runtime
 * in the task-failure-handler package — not defined here — because there is
 * no authoritative npm type package for ECS-specific EventBridge detail payloads.
 */

/**
 * Fields added to the DynamoDB scenario record for failure tracking.
 *
 * These are updated atomically by the Task Failure Handler Lambda using
 * a conditional DynamoDB UpdateExpression.
 */
export interface TaskFailureTrackingFields {
  /** Running count of tasks that exited unexpectedly during this test run */
  readonly taskFailureCount: number;
  /**
   * Minimum percentage (0–100) of tasks that must remain healthy for the
   * test to continue. Configurable per test scenario; default is 90.
   */
  readonly healthyThreshold: number;
}

/**
 * High-level classification of why an ECS task stopped.
 *
 * Used by the Task Failure Handler to categorize each task death for
 * both operational metrics (`TaskFailure.StopCategory`) and structured
 * logs.
 *
 * Current classification is intentionally conservative — the container's
 * exit codes do not yet distinguish between setup failures (download,
 * extract, checksum) and test script errors. Both currently use exit
 * code 1. A future task should introduce meaningful exit codes in
 * `load-test.sh` to enable finer-grained classification.
 *
 * @see docs/metrics-reference.md Section 2, TaskFailure event.
 * @see deployment/ecr/distributed-load-testing-on-aws-load-tester/load-test.sh
 */
export enum StopCategory {
  /** Container killed with exit code 137 — out of memory (SIGKILL / OOM) */
  OutOfMemory = "oom",
  /** ECS/Fargate infrastructure issue (placement failure, spot interruption, etc.) */
  Infrastructure = "infrastructure",
  /** bzt exited with a non-zero code (exit code 2) */
  BztError = "bzt_error",
  /** Container exited with non-zero code — cause not yet classifiable */
  ContainerError = "container_error",
  /** None of the above conditions matched */
  Unknown = "unknown",
}

/** ECS stop codes that indicate infrastructure-level failures. */
const INFRASTRUCTURE_STOP_CODES: ReadonlySet<string> = new Set([
  "TaskFailedToStart",
  "ServiceSchedulerInitiated",
  "SpotInterruption",
]);

/**
 * Classifies an ECS task stop into a high-level category.
 *
 * Classification logic:
 * - exitCode 2 → BztError (test framework failed)
 * - exitCode 137 → OOM (SIGKILL, typically from cgroup memory limit)
 * - stopCode in {TaskFailedToStart, ServiceSchedulerInitiated, SpotInterruption} → Infrastructure
 * - exitCode is a non-zero number (excluding 143) → ContainerError (could be setup failure
 *   or test script error — load-test.sh uses exit 1 for both)
 * - exitCode 0 or 143 (SIGTERM), undefined, or unrecognized → Unknown
 *
 * @param stopCode - The ECS `stopCode` field from the task state change event
 * @param exitCode - The container's exit code (`undefined` if the container never ran)
 * @returns The classified {@link StopCategory}
 */
export function classifyStopCode(stopCode: string, exitCode: number | undefined): StopCategory {
  if (exitCode === 2) {
    return StopCategory.BztError;
  }

  if (exitCode === 137) {
    return StopCategory.OutOfMemory;
  }

  if (INFRASTRUCTURE_STOP_CODES.has(stopCode)) {
    return StopCategory.Infrastructure;
  }

  // 143 = 128 + 15 (SIGTERM) — standard exit code when ECS sends SIGTERM
  // during normal shutdown (desiredCount=0, scale-down, spot draining).
  if (typeof exitCode === "number" && exitCode !== 0 && exitCode !== 143) {
    return StopCategory.ContainerError;
  }

  return StopCategory.Unknown;
}
