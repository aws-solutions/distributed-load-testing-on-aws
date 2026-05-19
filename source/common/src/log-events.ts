// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Stable, machine-parseable identifiers for important structured log events.
 *
 * Not every log call needs a `logEvent` field. Use these only for
 * significant lifecycle events that customers will query in CloudWatch
 * Logs Insights. Routine debug/trace logging should use plain `message`
 * strings without a `logEvent` field.
 *
 * CDK `QueryDefinition` constructs reference these values to create
 * saved queries in the customer's CloudWatch console.
 *
 * @example
 * ```typescript
 * logger.info("Service created successfully", {
 *   logEvent: LogEvent.SERVICE_CREATED,
 *   serviceName,
 *   desiredCount,
 * });
 * ```
 *
 * @see docs/metrics-reference.md Section 5 for the query catalog.
 */
export enum LogEvent {
  // ── Service Lifecycle ──
  /** ECS service created for a region */
  SERVICE_CREATED = "SERVICE_CREATED",
  /** Task runner handler failed (catch-all for any creation step) */
  TASK_RUNNER_FAILED = "TASK_RUNNER_FAILED",
  /** All tasks healthy and ready for test execution */
  SERVICE_READY = "SERVICE_READY",
  /** Stabilization failed (circuit breaker or timeout) */
  STABILIZATION_FAILED = "STABILIZATION_FAILED",
  /** 30-minute stabilization timeout exceeded */
  STABILIZATION_TIMEOUT = "STABILIZATION_TIMEOUT",

  // ── Regional Sync ──
  /** All regions validated after stabilization (gate to execution) */
  REGIONAL_SYNC_COMPLETE = "REGIONAL_SYNC_COMPLETE",

  // ── Start Command ──
  /** Start command Lambda invoked for a region */
  START_COMMAND_INVOKED = "START_COMMAND_INVOKED",
  /** S3 start marker written successfully */
  START_COMMAND_COMPLETE = "START_COMMAND_COMPLETE",

  // ── Test Execution ──
  /** All tasks in a region wrote S3 completion markers */
  REGION_COMPLETE = "REGION_COMPLETE",
  /** Completion monitoring timed out (no progress) */
  COMPLETION_TIMEOUT = "COMPLETION_TIMEOUT",

  // ── Task Failures ──
  /** Individual ECS task died (non-graceful) */
  TASK_FAILURE_DETECTED = "TASK_FAILURE_DETECTED",
  /** Task failure threshold breached — test marked as failed */
  TASK_THRESHOLD_BREACHED = "TASK_THRESHOLD_BREACHED",

  // ── Cleanup ──
  /** ECS resources cleaned up for a region */
  CLEANUP_COMPLETE = "CLEANUP_COMPLETE",
  /** ECS cleanup failed for a region */
  CLEANUP_FAILED = "CLEANUP_FAILED",

  // ── Cancellation ──
  /** User-initiated cancellation started */
  TEST_CANCEL_INITIATED = "TEST_CANCEL_INITIATED",

  // ── ECS Task Lifecycle (emitted by load-test.sh) ──
  /** Task received start signal and began test execution */
  TASK_STARTED = "TASK_STARTED",
  /** Task finished test execution and uploaded results */
  TASK_COMPLETED = "TASK_COMPLETED",
  /** Task failed during setup or test execution */
  TASK_FAILED = "TASK_FAILED",

  // ── Safety Layers ──
  /** Orphaned ECS service detected */
  ORPHAN_DETECTED = "ORPHAN_DETECTED",
  /** Step function failure detected by Layer 2 handler */
  SFN_FAILURE_DETECTED = "SFN_FAILURE_DETECTED",
}
