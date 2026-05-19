// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Static configuration data for test scenario form options

// Replace this local TestStatus enum with the import from @amzn/dlt-common
// once the webui package is fully migrated to the npm workspace.
// Canonical source: source/common/src/test-execution.ts

import type { Option } from "./types";

export enum TestStatus {
  QUEUED = "queued",
  PROVISIONING = "provisioning",
  RUNNING = "running",
  PARSING_RESULTS = "parsing results",
  CLEANING_UP = "cleaning up",
  COMPLETE = "complete",
  CANCELLING = "cancelling",
  CANCELLED = "cancelled",
  FAILED = "failed",
  SCHEDULED = "scheduled",
}

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
  RAMP_UP: { MIN: 0 },
  HOLD_FOR: { MIN: 1 },
  TEST_ID_LENGTH: 10,
} as const;

// Warning thresholds for user guidance
export const WARNING_THRESHOLDS = {
  TASK_COUNT: 2000,
  CONCURRENCY: 200,
} as const;

export enum StatusIndicatorType {
  SUCCESS = "success",
  PENDING = "pending",
  STOPPED = "stopped",
  ERROR = "error",
  LOADING = "loading",
  IN_PROGRESS = "in-progress",
  INFO = "info",
}

export interface StatusConfig {
  readonly type: StatusIndicatorType;
  readonly label: string;
}

export const FallbackStatusConfig: StatusConfig = {
  type: StatusIndicatorType.INFO,
  label: "",
};

export const STATUS_INDICATOR_MAP: Record<TestStatus, StatusConfig> = {
  [TestStatus.QUEUED]: { type: StatusIndicatorType.PENDING, label: "Queued" },
  [TestStatus.PROVISIONING]: { type: StatusIndicatorType.IN_PROGRESS, label: "Provisioning" },
  [TestStatus.RUNNING]: { type: StatusIndicatorType.LOADING, label: "Running" },
  [TestStatus.PARSING_RESULTS]: { type: StatusIndicatorType.IN_PROGRESS, label: "Parsing Results" },
  [TestStatus.CLEANING_UP]: { type: StatusIndicatorType.IN_PROGRESS, label: "Cleaning Up" },
  [TestStatus.COMPLETE]: { type: StatusIndicatorType.SUCCESS, label: "Complete" },
  [TestStatus.CANCELLING]: { type: StatusIndicatorType.STOPPED, label: "Cancelling" },
  [TestStatus.CANCELLED]: { type: StatusIndicatorType.STOPPED, label: "Cancelled" },
  [TestStatus.FAILED]: { type: StatusIndicatorType.ERROR, label: "Failed" },
  [TestStatus.SCHEDULED]: { type: StatusIndicatorType.PENDING, label: "Scheduled" },
};

/** All non-terminal states — used to gate auto-refresh and API task data inclusion. */
export const ACTIVE_TEST_STATES: ReadonlySet<TestStatus> = new Set([
  TestStatus.QUEUED,
  TestStatus.PROVISIONING,
  TestStatus.RUNNING,
  TestStatus.CANCELLING,
  TestStatus.CLEANING_UP,
  TestStatus.PARSING_RESULTS,
]);

/**
 * Returns the StatusConfig for a given status string.
 * Falls back to an info-type indicator with the raw status as label for unknown values.
 */
export const getStatusConfig = (status: string): StatusConfig => {
  const testStatusValues: ReadonlySet<string> = new Set(Object.values(TestStatus));
  if (testStatusValues.has(status)) {
    return STATUS_INDICATOR_MAP[status as TestStatus];
  }
  return { type: StatusIndicatorType.INFO, label: status };
};

/** Terminal states — auto-refresh is disabled when the test reaches one of these. */
const TERMINAL_TEST_STATES: ReadonlySet<string> = new Set<string>([
  TestStatus.COMPLETE,
  TestStatus.CANCELLED,
  TestStatus.FAILED,
  TestStatus.SCHEDULED,
]);

export const getPollingInterval = (status: string, userSelectedInterval: number): number =>
  userSelectedInterval;

/**
 * Returns true when the given status is a terminal state
 * (complete, cancelled, or failed).
 */
export const isTerminalState = (status: string): boolean =>
  TERMINAL_TEST_STATES.has(status);

