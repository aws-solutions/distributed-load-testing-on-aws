// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** CloudWatch namespace shared across all DLT packages. */
export const METRICS_NAMESPACE = "distributed-load-testing";

/**
 * Schema version for the operational metric envelope.
 *
 * Sent as the top-level `MetricSchemaVersion` field in every metric
 * payload. This should be incremented when a breaking change is made to the schema
 * or there is a desire to standardize with new fields.
 */
export const OPERATIONAL_METRIC_EVENT_VERSION = 1;

/**
 * Canonical names for operational metric events sent to the solutions
 * metrics endpoint. Every Lambda that calls {@link sendOperationalMetric}
 * must use a value from this enum as the `Type` field in the Data payload.
 *
 * @see docs/metrics-reference.md for the full catalog of events and their data fields.
 */
export enum OperationalMetricEvent {
  /** Step Function HTTP Task: before provisioning begins */
  TestStart = "TestStart",
  /** Step Function HTTP Task: after cleanup finishes */
  TestEnd = "TestEnd",
  /** Task Runner: ECS service created successfully */
  ServiceCreated = "ServiceCreated",
  /** Task Runner: ECS service creation error */
  ServiceCreateFailed = "ServiceCreateFailed",
  /** Stabilization Checker: all tasks healthy */
  ServiceReady = "ServiceReady",
  /** Stabilization Checker: circuit breaker or timeout */
  ServiceStabilizeFailed = "ServiceStabilizeFailed",
  /** Regional Sync: all regions validated */
  RegionsReady = "RegionsReady",
  /** Start Command Lambda: S3 start marker written for a region */
  StartCommandSent = "StartCommandSent",
  /** Task Status Checker: all tasks wrote S3 completion markers */
  RegionComplete = "RegionComplete",
  /** Task Status Checker: test exceeded testDuration + grace period */
  CompletionTimeout = "CompletionTimeout",
  /** Task Status Checker: test no longer running (threshold breached) */
  CompletionThresholdBreached = "CompletionThresholdBreached",
  /** Task Failure Handler: individual ECS task died (per-task event) */
  TaskFailure = "TaskFailure",
  /** Task Failure Handler: too many tasks died, threshold breached */
  TaskThresholdBreached = "TaskThresholdBreached",
  /** Task Canceler: user cancelled via API */
  TestCancel = "TestCancel",
  /** Test Cleanup: ECS resources cleaned up successfully */
  CleanupComplete = "CleanupComplete",
  /** Test Cleanup: ECS cleanup error */
  CleanupFailed = "CleanupFailed",
}

// ─── Per-event metric data types ────────────────────────────────────────────

/** Fields shared by every operational metric event. */
interface BaseMetricData {
  readonly Type: OperationalMetricEvent;
  readonly TestId: string;
}

/** Fields shared by events scoped to a specific test run in a region. */
interface RegionalMetricData extends BaseMetricData {
  readonly TestRunId: string;
  readonly Region: string;
}

/** Step Function: before provisioning begins. */
export interface TestStartMetric extends BaseMetricData {
  readonly Type: OperationalMetricEvent.TestStart;
  readonly TestType: string;
  readonly FileType: string;
  readonly TestDuration: number;
  readonly RegionCount: number;
}

/** Step Function: after cleanup finishes. */
export interface TestEndMetric extends BaseMetricData {
  readonly Type: OperationalMetricEvent.TestEnd;
  readonly TestType: string;
  readonly FinalStatus: string;
}

/** Task Runner: ECS service created successfully. */
export interface ServiceCreatedMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.ServiceCreated;
  readonly ServiceName: string;
  readonly DesiredCount: number;
}

/** Task Runner: ECS service creation error. */
export interface ServiceCreateFailedMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.ServiceCreateFailed;
  readonly Error: string;
}

/** Stabilization Checker: all tasks healthy. */
export interface ServiceReadyMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.ServiceReady;
  readonly TaskCount: number;
  readonly DesiredCount: number;
  readonly StabilizationDuration: number;
}

/** Stabilization Checker: circuit breaker or timeout. */
export interface ServiceStabilizeFailedMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.ServiceStabilizeFailed;
  readonly Error: string;
}

/** Regional Sync: all regions validated. */
export interface RegionsReadyMetric extends BaseMetricData {
  readonly Type: OperationalMetricEvent.RegionsReady;
  readonly TestRunId: string;
  readonly AllReady: boolean;
  readonly SyncDelay: number;
  readonly RegionCount: number;
}

/** Start Command: S3 start marker written for a region. */
export interface StartCommandSentMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.StartCommandSent;
}

/** Task Status Checker: all tasks wrote S3 completion markers. */
export interface RegionCompleteMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.RegionComplete;
  readonly CompletedTaskCount: number;
  readonly DesiredCount: number;
}

/** Task Status Checker: test exceeded testDuration + grace period. */
export interface CompletionTimeoutMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.CompletionTimeout;
  readonly ElapsedSeconds: number;
  readonly Deadline: number;
  readonly CompletedTaskCount: number;
  readonly DesiredCount: number;
}

/** Task Status Checker: test no longer running (threshold breached). */
export interface CompletionThresholdBreachedMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.CompletionThresholdBreached;
  readonly CompletedTaskCount: number;
  readonly DesiredCount: number;
}

/** Task Failure Handler: individual ECS task died. */
export interface TaskFailureMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.TaskFailure;
  readonly StopCode: string;
  readonly StopCategory: string;
  readonly FailureCount: number;
  readonly DesiredCount: number;
}

/** Task Failure Handler: too many tasks died, threshold breached. */
export interface TaskThresholdBreachedMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.TaskThresholdBreached;
  readonly FailureCount: number;
  readonly DesiredCount: number;
  readonly HealthyThreshold: number;
}

/** Task Canceler: user cancelled via API. */
export interface TestCancelMetric extends BaseMetricData {
  readonly Type: OperationalMetricEvent.TestCancel;
  readonly TestRunId?: string;
  readonly RegionCount?: number;
}

/** Test Cleanup: ECS resources cleaned up successfully. */
export interface CleanupCompleteMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.CleanupComplete;
  readonly FinalStatus: string;
}

/** Test Cleanup: ECS cleanup error. */
export interface CleanupFailedMetric extends RegionalMetricData {
  readonly Type: OperationalMetricEvent.CleanupFailed;
  readonly Error: string;
}

/** Discriminated union of all operational metric event payloads. */
export type OperationalMetricData =
  | TestStartMetric
  | TestEndMetric
  | ServiceCreatedMetric
  | ServiceCreateFailedMetric
  | ServiceReadyMetric
  | ServiceStabilizeFailedMetric
  | RegionsReadyMetric
  | StartCommandSentMetric
  | RegionCompleteMetric
  | CompletionTimeoutMetric
  | CompletionThresholdBreachedMetric
  | TaskFailureMetric
  | TaskThresholdBreachedMetric
  | TestCancelMetric
  | CleanupCompleteMetric
  | CleanupFailedMetric;

/**
 * Metric data payload sent to the solutions metrics endpoint.
 */
interface MetricPayload {
  Solution: string;
  UUID: string;
  TimeStamp: string;
  Version: string; // Solution Version (e.g. v0.0.0)
  MetricSchemaVersion: number;
  AccountId: string;
  Data: OperationalMetricData;
}

/**
 * Envelope containing the metric endpoint configuration.
 *
 * All fields must be provided explicitly by the caller — this avoids
 * hidden env var dependencies inside the metric function.
 */
export interface OperationalMetricEnvelope {
  readonly solutionId: string;
  readonly uuid: string;
  readonly version: string;
  readonly metricUrl: string;
  readonly accountId: string;
  readonly metricSchemaVersion: number;
}

/**
 * Sends an operational metric to the solutions metrics endpoint using
 * explicit envelope parameters.
 *
 * Fire-and-forget: errors are logged but never thrown.
 *
 * @param envelope - Metric endpoint configuration (solution ID, UUID, version, URL)
 * @param metricData - Typed metric event payload
 * @returns The HTTP status code on success, or `undefined` on failure
 */
export async function sendOperationalMetric(
  envelope: OperationalMetricEnvelope,
  metricData: OperationalMetricData
): Promise<number | undefined> {
  try {
    const payload: MetricPayload = {
      Solution: envelope.solutionId,
      UUID: envelope.uuid,
      TimeStamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
      Version: envelope.version,
      MetricSchemaVersion: envelope.metricSchemaVersion,
      AccountId: envelope.accountId,
      Data: metricData,
    };

    const response = await fetch(envelope.metricUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });

    return response.status;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error sending operational metric: ${message}`);
    return undefined;
  }
}
