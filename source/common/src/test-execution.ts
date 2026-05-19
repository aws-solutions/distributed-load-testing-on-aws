// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Types for configuring and launching a load test execution.
 *
 * These types represent the input payloads that flow into the task orchestration
 * step function — either from the DLT API (user-initiated tests) or from the
 * scheduler (recurring tests).
 */

/** Supported load testing frameworks */
export type TestType = "simple" | "jmeter" | "k6" | "locust";

/** Possible states of a test scenario in DynamoDB. */
export enum TestStatus {
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
  readonly fileType: string;
  readonly showLive: boolean;
  /** Total test duration in seconds (used by the Wait state) */
  readonly testDuration: number;
  /** S3 prefix for this test run's results, unique per execution */
  readonly prefix: string;
  /** Hub's task definition ARN — the single source of truth for task definition */
  readonly hubTaskDefinition: string;
  /** One entry per region — the Map state fans out over this array */
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
