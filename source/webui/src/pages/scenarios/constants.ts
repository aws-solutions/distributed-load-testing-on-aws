// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Static configuration data for test scenario form options

import { Option } from "./types";

export enum TestTypes {
  SIMPLE = "simple",
  JMETER = "jmeter",
  K6 = "k6",
  LOCUST = "locust",
}

export const TestTypeLabels: Option[] = [
  { label: "Single HTTP Endpoint", value: TestTypes.SIMPLE },
  { label: "JMeter", value: TestTypes.JMETER },
  { label: "K6", value: TestTypes.K6 },
  { label: "Locust", value: TestTypes.LOCUST },
];

export const HttpMethodOptions: Option[] = [
  { label: "GET", value: "GET" },
  { label: "POST", value: "POST" },
  { label: "PUT", value: "PUT" },
  { label: "DELETE", value: "DELETE" },
];

export const STEPS = {
  GENERAL_SETTINGS: 0,
  SCENARIO_CONFIG: 1,
  TRAFFIC_SHAPE: 2,
  REVIEW: 3,
} as const;

export const VALIDATION_LIMITS = {
  MAX_REGIONS: 5,
  TASK_COUNT: { MIN: 1 },
  CONCURRENCY: { MIN: 1 },
  TEST_ID_LENGTH: 10,
} as const;

// Warning thresholds for user guidance
export const WARNING_THRESHOLDS = {
  TASK_COUNT: 2000,
  CONCURRENCY: 200,
} as const;

export enum TestStatus {
  RUNNING = "running",
  COMPLETE = "complete",
  FAILED = "failed",
  CANCELLED = "cancelled",
  SCHEDULED = "scheduled",
  CANCELLING = "cancelling",
}

export enum StatusIndicatorType {
  SUCCESS = "success",
  PENDING = "pending",
  STOPPED = "stopped",
  ERROR = "error",
  LOADING = "loading",
}

export interface StatusConfig {
  type: StatusIndicatorType;
  label: string;
}

export const STATUS_INDICATOR_MAP: Record<TestStatus, StatusConfig> = {
  [TestStatus.RUNNING]: { type: StatusIndicatorType.LOADING, label: "Running" },
  [TestStatus.COMPLETE]: { type: StatusIndicatorType.SUCCESS, label: "Complete" },
  [TestStatus.SCHEDULED]: { type: StatusIndicatorType.PENDING, label: "Scheduled" },
  [TestStatus.CANCELLED]: { type: StatusIndicatorType.STOPPED, label: "Cancelled" },
  [TestStatus.FAILED]: { type: StatusIndicatorType.ERROR, label: "Failed" },
  [TestStatus.CANCELLING]: { type: StatusIndicatorType.STOPPED, label: "Cancelling" },
};
