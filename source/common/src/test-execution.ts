// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Types for configuring and launching a load test execution.
 *
 * These types represent the input payloads that flow into the task orchestration
 * step function — either from the DLT API (user-initiated tests) or from the
 * scheduler (recurring tests).
 */

import type { NativeRunMode } from "./api/create-test.ts";

/** Supported load test types (de-coupled from framework types to support types such as "simple"). */
export type TestType = "simple" | "jmeter" | "k6" | "locust";

/** All valid test types. */
export const TEST_TYPES: ReadonlySet<TestType> = new Set<TestType>(["simple", "jmeter", "k6", "locust"]);

export function isTestType(value: string): value is TestType {
  return TEST_TYPES.has(value as TestType);
}

/** Load test file types. */
export type FileType = "none" | "script" | "zip";

export const FILE_TYPES: ReadonlySet<FileType> = new Set<FileType>(["none", "script", "zip"]);

export function isFileType(value: string): value is FileType {
  return FILE_TYPES.has(value as FileType);
}

/** Supported load test frameworks. */
export type LoadTestFramework = "jmeter" | "k6" | "locust";

export const FRAMEWORKS: ReadonlySet<LoadTestFramework> = new Set<LoadTestFramework>(["jmeter", "k6", "locust"]);

export function isLoadTestFramework(value: string): value is LoadTestFramework {
  return FRAMEWORKS.has(value as LoadTestFramework);
}

/** Maps each TestType to a load test framework. */
export const TEST_TYPE_TO_FRAMEWORK: Readonly<Record<TestType, LoadTestFramework>> = {
  simple: "locust",
  jmeter: "jmeter",
  k6: "k6",
  locust: "locust",
};

/** Possible states of a test scenario in DynamoDB. */
export enum TestStatus {
  /** Test saved without running or scheduling a run. */
  CREATED = "created",
  /** Scheduled recurring test, awaiting its next run. */
  SCHEDULED = "scheduled",
  /** Test submitted via API, step function not yet started. */
  QUEUED = "queued",
  /** Task Runner created ECS service, waiting for stabilization. */
  PROVISIONING = "provisioning",
  /** START command sent, load test executing. */
  RUNNING = "running",
  /** All tasks complete, results being parsed. */
  PARSING_RESULTS = "parsing results",
  /** Results parsed, ECS resources being cleaned up. */
  CLEANING_UP = "cleaning up",
  /** Test finished successfully. */
  COMPLETE = "complete",
  /** User requested cancellation, cleanup in progress. */
  CANCELLING = "cancelling",
  /** Cancellation cleanup finished. */
  CANCELLED = "cancelled",
  /** Test failed due to error, threshold breach, or timeout. */
  FAILED = "failed",
}

/**
 * Statuses that indicate an in-flight run.
 *
 * A scenario in any of these states already has an active run and must not be
 * started again: DLT names the per-region ECS service run-agnostically
 * (dlt-{testId}-{region}), so a second run would collide with and corrupt the
 * live one. This is the single source of truth for "is this scenario busy" —
 * the API start guard, the atomic run-slot claim, and clients (CLI, console)
 * all derive from it, so a new lifecycle state cannot be added without every
 * enforcement point picking it up.
 */
export const ACTIVE_RUN_STATUSES: ReadonlySet<TestStatus> = new Set<TestStatus>([
  TestStatus.QUEUED,
  TestStatus.PROVISIONING,
  TestStatus.RUNNING,
  TestStatus.CANCELLING,
  TestStatus.CLEANING_UP,
  TestStatus.PARSING_RESULTS,
]);

/** True when the given status represents an in-flight run (see ACTIVE_RUN_STATUSES). */
export function isActiveRunStatus(status: string): boolean {
  return ACTIVE_RUN_STATUSES.has(status as TestStatus);
}

/**
 * Statuses that indicate a finished or idle scenario — the complement of
 * ACTIVE_RUN_STATUSES. A scenario in one of these states may be safely edited
 * (saveOnly), deleted, or started. Single source of truth mirrored by the API's
 * edit/delete guards and the web console's action gating. An unknown status is
 * deliberately not terminal (so actions stay disabled for it).
 */
export const TERMINAL_RUN_STATUSES: ReadonlySet<TestStatus> = new Set<TestStatus>([
  TestStatus.COMPLETE,
  TestStatus.CANCELLED,
  TestStatus.FAILED,
  TestStatus.SCHEDULED,
  TestStatus.CREATED,
]);

/** True when the given status represents a finished or idle scenario (see TERMINAL_RUN_STATUSES). */
export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status as TestStatus);
}

/**
 * True when a test run may be set as a scenario's baseline.
 *
 * Only a run that completed successfully is a valid baseline: a failed,
 * cancelled, or in-flight run has no meaningful results to compare future runs
 * against. This is the single source of truth for baseline eligibility — the
 * API's setBaseline guard and the web console's "Set Baseline" control both
 * derive from it, so the rule cannot drift between clients.
 */
export function isBaselineEligibleRunStatus(status: string | undefined): boolean {
  return status === TestStatus.COMPLETE;
}

/**
 * Run states in which a cancel request is meaningful and safe to accept. This is
 * the active set minus the finishing states (CLEANING_UP, PARSING_RESULTS): the
 * test has already run by then, so cancelling has little value, and a cancel in
 * those states races the step function's terminal metadata write and can leave
 * the scenario and run/history records with different statuses. CANCELLING is
 * included so a repeat cancel while cleanup is in progress stays idempotent.
 */
export const CANCELABLE_RUN_STATUSES: ReadonlySet<TestStatus> = new Set<TestStatus>([
  TestStatus.QUEUED,
  TestStatus.PROVISIONING,
  TestStatus.RUNNING,
  TestStatus.CANCELLING,
]);

/** True when a run in the given status can be cancelled (see CANCELABLE_RUN_STATUSES). */
export function isCancelableRunStatus(status: string): boolean {
  return CANCELABLE_RUN_STATUSES.has(status as TestStatus);
}

/**
 * Top-level input to the task orchestration step function.
 *
 * Contains test metadata and an array of per-region configurations.
 * The step function's Map state iterates over `testTaskConfig` to
 * orchestrate ECS services in parallel across regions.
 */
export interface TestExecutionInput {
  readonly testId: string;
  readonly testRunId: string;
  readonly testType: TestType;
  readonly fileType: FileType;
  readonly showLive: boolean;
  /** Total test duration in seconds (used by the Wait state) */
  readonly testDuration: number;
  /** S3 prefix for this test run's results, unique per execution */
  readonly prefix: string;

  /** Native runner configuration, or null when using Taurus. Kept nullable
   * because the Step Functions Map selector requires the path to exist. */
  readonly nativeRunMode: NativeRunMode | null;

  /** Taurus task definition ARN. Used when nativeRunMode is null. */
  readonly hubTaskDefinition: string;

  /** Per-framework native task definition ARNs. Task Runner selects the ARN
   * matching the test's framework when nativeRunMode is present.
   *
   * Partial<> until all task definitions are available. */
  readonly nativeTaskDefinitions: Readonly<Partial<Record<LoadTestFramework, string>>>;

  /** One entry per region — the Map state fans out over this array. */
  readonly testTaskConfig: TestTaskRegionConfig[];
}

/**
 * Per-region ECS configuration — one entry per Map State iteration.
 *
 * Each region in a multi-region test gets its own cluster, subnets,
 * security group, and task definition. The task runner uses this config
 * to create a test-specific task definition revision and ephemeral
 * ECS service in the target region.
 */
export interface TestTaskRegionConfig {
  readonly region: string;
  readonly taskCluster: string;
  readonly taskCount: number;
  readonly subnetA: string;
  readonly subnetB: string;
  readonly taskSecurityGroup: string;
  readonly ecsCloudWatchLogGroup: string;
  /** Spoke's ECS task role ARN, written to DynamoDB by the spoke's custom resource */
  readonly taskRoleArn: string;
  /** Spoke's ECS task execution role ARN, written to DynamoDB by the spoke's custom resource */
  readonly executionRoleArn: string;
}
