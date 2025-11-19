// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { TestTaskConfig } from "../types";
import { ViewMode } from "./viewMode";

// Labels, in this context, refer to a single unit for load tests.
// e.g. a single endpoint in a JMeter test scenario which targets multiple endpoints.
export interface LabelMetrics {
  avg_lt: string;
  p0_0: string;
  p99_0: string;
  stdev_rt: string;
  avg_ct: string;
  label: string;
  concurrency: string;
  p99_9: string;
  fail: number;
  rc: ResponseCode[];
  succ: number;
  p100_0: string;
  bytes: string;
  p95_0: string;
  avg_rt: string;
  throughput: number;
  p90_0: string;
  testDuration: string;
  p50_0: string;
}

export interface TestResults {
  avg_lt: string;
  p0_0: string;
  p99_0: string;
  stdev_rt: string;
  avg_ct: string;
  metricS3Location?: string;
  concurrency: string;
  p99_9: string;
  labels: LabelMetrics[];
  fail: number;
  rc: ResponseCode[];
  succ: number;
  p100_0: string;
  bytes: string;
  p95_0: string;
  avg_rt: string;
  throughput: number;
  p90_0: string;
  testDuration: string;
  p50_0: string;
}

export interface TestScenarioExecution {
  taskCount?: number;
  'hold-for'?: string;
  scenario?: string;
  'ramp-up'?: string;
  executor?: string;
  concurrency?: number;
}

export interface TestScenario {
  execution?: TestScenarioExecution[];
}

export interface TestRunDetails {
  startTime: string;
  testDescription: string;
  testId: string;
  endTime: string;
  testTaskConfigs: TestTaskConfig[];
  completeTasks: {
    [region: string]: number;
  };
  testType: string;
  status: "running" | "complete" | "failed" | "cancelled";
  succPercent: string;
  testRunId: string;
  results: {
    [regionOrTotal: string]: TestResults; // Either region name or 'total'
  };
  testScenario?: TestScenario;
}

export interface ResponseCode {
  count: number;
  code: string;
}

export interface TableRow {
  id: string;
  run: string;
  region: string;
  testLabel: string;
  requests: number;
  success: number;
  successRate: number;
  avgRespTime: number;
  p95RespTime: number;
  errors: number;
  requestsPerSecond: number;
  avgLatency: number;
  avgConnectionTime: number;
  avgBandwidth: number;
  p0RespTime: number;
  p50RespTime: number;
  p90RespTime: number;
  p99RespTime: number;
  p99_9RespTime: number;
  p100RespTime: number;
}

export interface TestResultsTableProps {
  tableData: TableRow[];
  selectedItems: TableRow[];
  onSelectionChange: (selectedItems: TableRow[]) => void;
  baseline?: BaselineResponse;
}

export interface TestRunDashboardProps {
  selectedRow: TableRow | null;
  testRunDetails: TestRunDetails | null;
  baseline?: BaselineResponse;
  viewMode: ViewMode;
}

// Baseline-specific interfaces
export interface BaselineTestRunDetails {
  testRunId: string;
  startTime: string;
  endTime: string;
  status: string;
  results: {
    [regionOrTotal: string]: TestResults;
  };
}

export interface BaselineResponse {
  testId: string;
  baselineId: string | null;
  message: string;
  testRunDetails?: BaselineTestRunDetails;
  warning?: string;
}
