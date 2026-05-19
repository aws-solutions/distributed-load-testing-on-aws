// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TestStatus } from "./constants";
import { TestTypes } from "./constants";

// TypeScript interfaces for form data
import React from "react";

export interface RegionConfig {
  region: string;
  taskCount: string;
  concurrency: string;
}

export interface FormData {
  testName: string;
  testDescription: string;
  testId: string;
  testType: TestTypes.SIMPLE | TestTypes.JMETER | TestTypes.K6 | TestTypes.LOCUST;
  executionTiming: string;
  showLive: boolean;
  scriptFile: File[];
  fileError: string;
  tags: Array<{ label: string; dismissLabel: string }>;
  httpEndpoint: string;
  httpMethod: { label: string; value: string };
  requestHeaders: string;
  bodyPayload: string;
  scheduleTime: string;
  scheduleDate: string;
  cronMinutes: string;
  cronHours: string;
  cronDayOfMonth: string;
  cronMonth: string;
  cronDayOfWeek: string;
  cronExpiryDate: string;
  scheduleTimezone: string;
  regions: RegionConfig[];
  rampUpUnit: string;
  rampUpValue: string;
  holdForUnit: string;
  holdForValue: string;
  healthyThreshold: string;
  k6LicenseAcknowledged: boolean;
}

export interface Option {
  label: string;
  value: string;
}

// Scenario Definition interfaces

/**
 * Aggregate ECS task counts for a single region, as returned by describeServices.
 * Designed to align with a future @amzn/dlt-common shared type.
 *
 * describeServices provides running, pending, and desired counts. It does not
 * report stopped or provisioning counts. Stopped task counts come from
 * taskFailureCount on the scenario record (tracked by the Task Failure Handler).
 */
export interface TasksPerRegion {
  region: string;
  running: number;
  pending: number;
  desired: number;
}

export interface TestTaskConfig {
  region: string;
  taskCount: number;
  concurrency: number;
  taskCluster?: string;
  taskDefinition?: string;
  ecsCloudWatchLogGroup?: string;
}

export interface TestRun {
  testRunId: string;
  startTime: string;
  endTime?: string;
  status?: "running" | "complete" | "failed" | "cancelled";
  scheduleTimezone?: string;
  requests?: number;
  success?: number;
  errors?: number;
  requestsPerSecond?: number;
  avgResponseTime?: number;
  avgLatency?: number;
  avgConnectionTime?: number;
  avgBandwidth?: number;
  isBaseline?: boolean;
  percentiles?: {
    p0?: number;
    p50?: number;
    p90?: number;
    p95?: number;
    p99?: number;
    p99_9?: number;
    p100?: number;
  };
}

export interface TestRunsResponse {
  testRuns: TestRun[];
  pagination?: {
    limit?: number;
    next_token?: string;
    total_count?: number;
  };
}

// Table column interface with data/presentation separation
export interface TableColumn<T> {
  id: string;
  header: string;
  cell: (item: T) => React.ReactNode;
  csvValue: (item: T) => string;
  csvBaselineValue?: (item: T) => string;
  sortingField?: string;
  sortingComparator?: (a: T, b: T) => number;
  preferenceHeader?: string;
}

export interface ScenarioDefinition {
  testId: string;
  testName: string;
  testDescription: string;
  testType: string;
  status: TestStatus;
  errorReason?: string;
  testTaskConfigs: TestTaskConfig[];
  tasksPerRegion?: TasksPerRegion[];
  startTime?: string;
  endTime?: string;
  nextRun?: string;
  scheduleRecurrence?: string;
  cronValue?: string;
  cronExpiryDate?: string;
  scheduleTimezone?: string;
  showLive?: boolean;
  fileType?: string;
  tags?: string[];
   
  testScenario?: any;
  history?: TestRun[];
  results?: Record<string, unknown>;
  totalTestRuns?: number;
  /**
   * Count of ECS tasks that exited unexpectedly during the current test run.
   * Tracked by the Task Failure Handler via atomic DynamoDB increments.
   * Used by the frontend as the "stopped" count in the task status table,
   * since describeServices does not report stopped task counts.
   */
  taskFailureCount?: number;
  // Allow additional fields for API extensibility
  [key: string]: unknown;
}

export interface TaskStatusItem {
  readonly region: string;
  readonly running: number;
  readonly pending: number;
  readonly provisioning: number;
  readonly stopped: number;
  readonly desired: number;
  readonly concurrency: number;
  readonly regionStatus: "Ready" | "Provisioning" | "Degraded" | "Stopping";
}
