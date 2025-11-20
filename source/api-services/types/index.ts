// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * TypeScript type definitions for API inputs
 */

// ============================================================================
// Path Parameters
// ============================================================================

export interface PathParameters {
  testId?: string;
  testRunId?: string;
}

// ============================================================================
// Query Parameters by Endpoint
// ============================================================================

export interface ScenariosQueryParams {
  op?: "listRegions";
  tags?: string; // Comma-separated tags
}

export interface ScenarioQueryParams {
  history?: "true" | "false";
  latest?: "true" | "false";
}

export interface TestRunsQueryParams {
  limit?: string | number;
  start_timestamp?: string;
  end_timestamp?: string;
  latest?: "true" | "false";
  next_token?: string;
}

export interface BaselineQueryParams {
  data?: "true" | "false";
}

// ============================================================================
// Request Body Types
// ============================================================================

export interface TestTaskConfig {
  region: string;
  taskCount: number | string;
  concurrency: number | string;
}

export interface TestScenarioExecution {
  concurrency?: number;
  "ramp-up"?: string | number;
  "hold-for"?: string | number;
  scenario?: string;
  executor?: "locust" | "k6" | "jmeter";
  taskCount?: number;
}

export interface TestScenario {
  execution: TestScenarioExecution[];
  reporting?: Array<{
    module: string;
    summary?: boolean;
    percentiles?: boolean;
    "summary-labels"?: boolean;
    "test-duration"?: boolean;
    "dump-xml"?: string;
  }>;
}

export interface RegionalTaskDetails {
  [region: string]: {
    dltAvailableTasks: number | string;
  };
}

// ============================================================================
// POST /scenarios - Create Test
// ============================================================================

export interface CreateTestRequest {
  testId?: string;
  testName: string;
  testDescription: string;
  testType: "simple" | "jmeter" | "locust" | "k6";
  fileType?: "none" | "script" | "zip";
  testTaskConfigs: TestTaskConfig[];
  testScenario: TestScenario;
  showLive?: boolean;
  regionalTaskDetails: RegionalTaskDetails;
  tags?: string[];
  scheduleStep?: "create" | "start";
  scheduleDate?: string;
  scheduleTime?: string;
  recurrence?: "daily" | "weekly" | "biweekly" | "monthly";
  cronValue?: string;
  cronExpiryDate?: string;
  eventBridge?: string;
}

// ============================================================================
// PUT /scenarios/{testId}/baseline - Set Baseline
// ============================================================================

export interface SetBaselineRequest {
  testRunId: string;
}

// ============================================================================
// DELETE /scenarios/{testId}/testruns - Delete Test Runs
// ============================================================================

export type DeleteTestRunsRequest = string[];

// ============================================================================
// API Event Structure
// ============================================================================

export interface APIEvent {
  resource: string;
  httpMethod: string;
  headers?: {
    "User-Agent"?: string;
    "user-agent"?: string;
    "X-Correlation-Id"?: string;
    "x-correlation-id"?: string;
  };
  pathParameters?: PathParameters;
  queryStringParameters?: Record<string, string>;
  body?: string;
}

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}
