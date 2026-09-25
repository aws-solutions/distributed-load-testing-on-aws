// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { NativeRunMode } from "@amzn/dlt-common";

// ---------------------------------------------------------------------------
// Shared CLI types
// ---------------------------------------------------------------------------

/** Supported output formats for CLI commands. */
export type OutputFormat = "json" | "table" | "csv";

// ---------------------------------------------------------------------------
// API response types for the DLT REST API
// ---------------------------------------------------------------------------

export interface TestTaskConfig {
  region: string;
  taskCount: number;
  concurrency: number;
  [key: string]: unknown;
}

/**
 * A single test scenario as returned by the REST API (GET /scenarios or
 * GET /scenarios/:id).
 *
 * Deliberately not `@amzn/dlt-common`'s `ScenarioRecord`: that type describes
 * the DynamoDB storage shape, where `testScenario` is a JSON *string* and
 * fields like `status`, `desiredTaskCount`, and `taskFailureCount` are
 * required. The REST responses this CLI consumes differ — `testScenario` is
 * commonly returned as a parsed object and most fields are optional — so this
 * response-shaped type stays separate. The shared `NativeRunMode` type is
 * reused directly since that sub-object is identical on both sides.
 */
export interface Scenario {
  testId: string;
  testName: string;
  testDescription?: string;
  testType?: string;
  fileType?: string;
  status?: string;
  startTime?: string;
  nextRun?: string;
  showLive?: boolean;
  testTaskConfigs?: TestTaskConfig[];
  testScenario?: string | Record<string, unknown>;
  tags?: string[];
  healthyThreshold?: number;
  /** Present when the scenario runs through a framework's native runner. */
  nativeRunMode?: NativeRunMode;
  /** Recurring schedule fields (present when the scenario is cron-scheduled). */
  cronValue?: string;
  cronExpiryDate?: string;
  scheduleTimezone?: string;
  /**
   * One-time schedule fields, derived by the API from nextRun and returned on
   * read (present when the scenario is a one-time "Run Once" schedule).
   */
  scheduleDate?: string;
  scheduleTime?: string;
  [key: string]: unknown;
}

/** Response from GET /scenarios */
export interface ScenariosListResponse {
  Items: Scenario[];
}

/** A single test run */
export interface TestRun {
  testRunId: string;
  testId?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  testType?: string;
  [key: string]: unknown;
}

/** Pagination metadata returned with paginated responses */
export interface Pagination {
  limit?: number;
  next_token?: string;
  total_count?: number;
}

/** Response from GET /scenarios/:id/testruns */
export interface TestRunsResponse {
  testRuns: TestRun[];
  pagination?: Pagination;
}

/** Results data for a single region or 'total' aggregate */
export interface TestResultsData {
  labels?: Array<Record<string, unknown>>;
  succ?: number;
  fail?: number;
  throughput?: number;
  avg_rt?: string;
  p50_0?: string;
  p90_0?: string;
  p99_0?: string;
  testDuration?: string;
  [key: string]: unknown;
}

/** Response from GET /scenarios/:id/baseline */
export interface BaselineResponse {
  testId: string;
  baselineId: string | null;
  message: string;
  testRunDetails?: {
    testRunId: string;
    startTime: string;
    endTime: string;
    status: string;
    results: {
      [regionOrTotal: string]: TestResultsData;
    };
  };
  warning?: string;
}

export interface VCpuRegionDetails {
  vCPULimit: number;
  vCPUsInUse: number;
  vCPUsPerTask: number;
  [key: string]: number;
}

/** Response from GET /vCPUDetails */
export interface VCpuDetailsResponse {
  [region: string]: VCpuRegionDetails;
}

/** Formatted test results for display in table/JSON/CSV output. */
export interface FormattedTestResults {
  avgResponseTime: number;
  avgLatency: number;
  avgConnectionTime: number;
  p0: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  p100: number;
  stdDevResponseTime: number;
  errorRate: number;
  successCount: number;
  errorCount: number;
  totalRequests: number;
  throughput: number;
  testDuration: number;
  bytesAvg: number;
  [key: string]: unknown;
}
