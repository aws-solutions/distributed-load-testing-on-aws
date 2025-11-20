// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

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
  regions: RegionConfig[];
  rampUpUnit: string;
  rampUpValue: string;
  holdForUnit: string;
  holdForValue: string;
}

export interface Option {
  label: string;
  value: string;
}

// Scenario Definition interfaces

export interface Task {
  lastStatus: "RUNNING" | "PENDING" | "PROVISIONING" | "STOPPED";
  taskArn?: string;
  taskDefinitionArn?: string;
  clusterArn?: string;
  createdAt?: string;
  startedAt?: string;
  stoppedAt?: string;
}

export interface TasksPerRegion {
  region: string;
  tasks: Task[];
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
  status: "running" | "complete" | "failed" | "cancelled" | "scheduled" | "cancelling";
  testTaskConfigs: TestTaskConfig[];
  tasksPerRegion?: TasksPerRegion[];
  startTime?: string;
  endTime?: string;
  nextRun?: string;
  scheduleRecurrence?: string;
  cronValue?: string;
  cronExpiryDate?: string;
  showLive?: boolean;
  fileType?: string;
  tags?: string[];
  testScenario?: any;
  history?: TestRun[];
  results?: Record<string, unknown>;
  totalTestRuns?: number;
  // Allow additional fields for API extensibility
  [key: string]: unknown;
}
