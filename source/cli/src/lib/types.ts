// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// ---------------------------------------------------------------------------
// Shared CLI types
// ---------------------------------------------------------------------------

/** Supported output formats for CLI commands. */
export type OutputFormat = "json" | "table";

// ---------------------------------------------------------------------------
// API response types for the DLT REST API
// ---------------------------------------------------------------------------

export interface TestTaskConfig {
  region: string;
  taskCount: number;
  concurrency: number;
  [key: string]: unknown;
}

/** A single test scenario (from GET /scenarios or GET /scenarios/:id) */
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
