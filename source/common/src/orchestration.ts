// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Types for the step function orchestration phases.
 *
 * The task orchestration step function has three phases:
 *   Phase 1 — Stabilization: Creates ephemeral ECS services per region and
 *             polls until all tasks are healthy (health check passes).
 *   Phase 2 — Regional Sync: Validates all regions are ready before any
 *             region begins test execution. Acts as a synchronization barrier.
 *   Phase 3 — Execution: Writes S3 start markers per region so tasks begin
 *             test execution, waits for the test duration, then polls S3
 *             completion markers until all tasks have finished.
 *
 * Each interface represents the payload shape passed between step function
 * states. Fields marked as "pass-through" are forwarded unchanged from the
 * original TestExecutionInput so downstream states have context without
 * needing to query DynamoDB.
 */

import type { TestTaskRegionConfig, TestType } from "./test-execution.js";
import { TestStatus } from "./test-execution.js";

/**
 * ECS service lifecycle status values.
 *
 * The AWS ECS SDK does not export an enum for this field.
 * @see https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Service.html
 */
export enum EcsServiceStatus {
  ACTIVE = "ACTIVE",
  DRAINING = "DRAINING",
  INACTIVE = "INACTIVE",
}

/** Status values for ECS service stabilization within the step function loop. */
export enum StabilizationStatus {
  /** All tasks healthy and ready for test execution. */
  READY = "READY",
  /** Service still stabilizing — step function loops back to Wait. */
  PENDING = "PENDING",
  /** Circuit breaker triggered or timeout exceeded. */
  FAILED = "FAILED",
}

/**
 * Phase 1a output: Returned by the Task Runner Lambda after creating
 * resources (task definition, ECS service, CloudWatch dashboard) for
 * one region.
 *
 * This type does NOT include stabilization status — the Task Runner
 * only creates resources and returns immediately. Stabilization is
 * driven by the step function's Wait → Lambda → Choice loop, which
 * produces a {@link ServiceStabilizationResult}.
 */
export interface TaskRunnerResult {
  // Pass-through fields (forwarded from TestExecutionInput for downstream use)
  readonly testId: string;
  readonly testRunId: string;
  readonly testType: TestType;
  readonly fileType: string;
  readonly showLive: boolean;
  readonly testDuration: number;
  readonly prefix: string;
  readonly testTaskConfig: TestTaskRegionConfig;

  /** ECS service name (format: `dlt-{testId}-{region}`) */
  readonly serviceName: string;
  readonly serviceArn: string;
  /** ARN of the test-specific task definition revision (not the base) */
  readonly taskDefinitionArn: string;
  /** Task definition family (format: `dlt-worker-{testId}`) */
  readonly taskDefinitionFamily: string;
  readonly desiredCount: number;
}

/**
 * Phase 1b output: Returned by the Stabilization Checker Lambda after
 * verifying that an ECS service has reached its desired task count.
 *
 * The step function drives a Wait → Stabilization Checker → Choice loop.
 * Each iteration calls describeServices() and checks runningCount against
 * desiredCount. The loop continues until stable, failed (circuit breaker),
 * or timed out.
 *
 * The Map state collects one of these per region, then passes the array
 * to the Regional Sync Lambda.
 */
export interface ServiceStabilizationResult {
  // Pass-through fields (forwarded from TestExecutionInput for downstream use)
  readonly testId: string;
  readonly testRunId: string;
  readonly testType: TestType;
  readonly fileType: string;
  readonly showLive: boolean;
  readonly testDuration: number;
  readonly prefix: string;
  readonly testTaskConfig: TestTaskRegionConfig;

  /** Whether the ECS service reached its desired task count */
  readonly status: StabilizationStatus;
  /**
   * Epoch milliseconds when stabilization polling started.
   *
   * Set by the Stabilization Checker on the first invocation and passed
   * through on every PENDING return so the step function preserves it
   * across loop iterations. Used to enforce the 30-minute timeout.
   */
  readonly stabilizationStartTime: number;
  /** ECS service name (format: `dlt-{testId}-{region}`) */
  readonly serviceName: string;
  readonly serviceArn: string;
  /** ARN of the test-specific task definition revision (not the base) */
  readonly taskDefinitionArn: string;
  /** Task definition family (format: `dlt-worker-{testId}`) */
  readonly taskDefinitionFamily: string;
  readonly desiredCount: number;
  readonly runningCount: number;
  /** Epoch milliseconds when the service was confirmed stable */
  readonly readyTimestamp: number;
  /** Present only when status is "FAILED" */
  readonly errorMessage?: string;
}

/**
 * Phase 2 output: Returned by the Regional Sync Lambda after validating
 * that all regions have stable ECS services.
 *
 * If any region failed stabilization, `allReady` is false and the step
 * function cancels the entire test across all regions.
 */
export interface RegionalSyncResult {
  readonly allReady: boolean;
  /** Milliseconds between the fastest and slowest region stabilization */
  readonly syncDelay: number;
  readonly regions: ServiceStabilizationResult[];
  /** Region names that failed to stabilize (present only when allReady is false) */
  readonly failedRegions?: string[];
}

/**
 * Event accepted by the test-cleanup Lambda.
 *
 * Contains everything needed to clean up ECS resources for one region
 * and set the final DDB test status. Invoked from:
 *   - Step function Catch states (finalStatus: FAILED)
 *   - Step function Phase 3 cleanup map (finalStatus: COMPLETE)
 *   - task-canceler (finalStatus: CANCELLED)
 *   - sfn-failure-handler (finalStatus: FAILED)
 *
 * The Lambda derives `serviceName` and `taskDefinitionFamily` from
 * `testId` and `testTaskConfig.region` using `buildServiceName()` and
 * `buildTaskDefinitionFamily()`. Callers do not need to provide them.
 */
export interface TestCleanupEvent {
  readonly testId: string;
  readonly testRunId: string;
  readonly testTaskConfig: TestTaskRegionConfig;

  /** Terminal status to write to DDB after cleanup. */
  readonly finalStatus: TestStatus;

  /** Error message — written to DDB errorReason when finalStatus is FAILED. */
  readonly errorReason?: string;

  /**
   * When true, skip the DynamoDB status update after resource cleanup.
   * Set by the SFN Cleanup Map so terminal status is deferred to the final SFN step.
   */
  readonly skipStatusUpdate?: boolean;
}

/**
 * Event accepted by the task-canceler Lambda.
 *
 * The API sends just `{ testId }`. The canceler resolves everything
 * else (testRunId, region configs) from the active SFN execution input.
 */
export interface TaskCancelEvent {
  readonly testId: string;
}

/**
 * Phase 3 state: Flows through the completion monitoring loop within
 * each region's execution branch.
 *
 * The step function polls S3 completion markers (one per finished task)
 * and updates `completedTaskCount` each iteration. Once all tasks have
 * written their marker or the timeout fires, the Task Canceler drains
 * and deletes the ECS service.
 */
export interface CompletionMonitoringEvent {
  // Pass-through fields
  readonly testId: string;
  readonly testRunId: string;
  readonly testType: TestType;
  readonly fileType: string;
  readonly showLive: boolean;
  readonly testDuration: number;
  readonly prefix: string;
  readonly testTaskConfig: TestTaskRegionConfig;

  // Service context (from Phase 1)
  readonly serviceName: string;
  readonly serviceArn: string;
  readonly taskDefinitionArn: string;
  readonly taskDefinitionFamily: string;
  readonly desiredCount: number;

  // Polling state (updated each iteration)
  /** Number of S3 completion markers found so far */
  readonly completedTaskCount: number;
  /** True when completedTaskCount >= desiredCount */
  readonly isComplete: boolean;
  /** True when the deadline has been exceeded or the test is no longer running */
  readonly timedOut: boolean;
  /** Epoch millis when completion polling started — set on first invocation */
  readonly pollStartTime: number;
  /** Reason for failure — forwarded to test-cleanup when timedOut is true */
  readonly errorReason?: string;
}
