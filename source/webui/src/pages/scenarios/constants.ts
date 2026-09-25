// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Static configuration data for test scenario form options

// Scenario status vocabulary and guards (TestStatus, ACTIVE_RUN_STATUSES,
// isTerminalRunStatus, ...) are owned by @amzn/dlt-common
// (source/common/src/test-execution.ts) — import them from there directly. This
// file keeps only webui-specific presentation config and imports TestStatus for
// the status-indicator map below.

import { MAX_TEST_DURATION_SECONDS, TestStatus } from "@amzn/dlt-common/validation";
import { TRAFFIC_SHAPE_LABELS, TRAFFIC_SHAPE_SHORT_DEFINITIONS } from "@amzn/dlt-common/traffic-shape";
import type { Option } from "./types";

export enum TestTypes {
  SIMPLE = "simple",
  JMETER = "jmeter",
  K6 = "k6",
  LOCUST = "locust",
}

export enum TestMode {
  STANDARD = "standard",
  NATIVE = "native",
}

export const TestTypeLabels: Option[] = [
  { label: "Simple HTTP Endpoint", value: TestTypes.SIMPLE },
  { label: "JMeter", value: TestTypes.JMETER },
  { label: "K6", value: TestTypes.K6 },
  { label: "Locust", value: TestTypes.LOCUST },
];

// Map a stored test-type value to the same human-readable label the create/edit
// form shows, so summary/detail screens stay consistent with it. Falls back to
// the raw value for unknown/legacy types.
export const getTestTypeLabel = (value: string): string =>
  TestTypeLabels.find((option) => option.value === value)?.label ?? value;

// Traffic-shape mode labels and copy, sourced from @amzn/dlt-common/traffic-shape
// so the console cannot drift from the CLI, the MCP server, and the docs. Every
// render site pulls from here rather than hardcoding its own wording.
export const TestModeLabels: Option[] = [
  { label: TRAFFIC_SHAPE_LABELS.standard, value: TestMode.STANDARD },
  { label: TRAFFIC_SHAPE_LABELS.native, value: TestMode.NATIVE },
];

// Short definitions for the traffic-shape segmented control helper text. The info
// panel needs the medium tier instead, and imports it straight from
// @amzn/dlt-common/traffic-shape in src/help/content.ts rather than through here,
// so that src/help does not depend on a page's constants.
export const TestModeShortDescriptions: Record<TestMode, string> = {
  [TestMode.STANDARD]: TRAFFIC_SHAPE_SHORT_DEFINITIONS.standard,
  [TestMode.NATIVE]: TRAFFIC_SHAPE_SHORT_DEFINITIONS.native,
};

export const HttpMethodOptions: Option[] = [
  { label: "GET", value: "GET" },
  { label: "POST", value: "POST" },
  { label: "PUT", value: "PUT" },
  { label: "DELETE", value: "DELETE" },
];

export const VALIDATION_LIMITS = {
  MAX_REGIONS: 5,
  TASK_COUNT: { MIN: 1 },
  CONCURRENCY: { MIN: 1 },
  RAMP_UP: { MIN: 0 },
  HOLD_FOR: { MIN: 1 },
  TEST_ID_LENGTH: 10,
  DURATION: { MIN: 1, MAX_SECONDS: MAX_TEST_DURATION_SECONDS },
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
  [TestStatus.CREATED]: { type: StatusIndicatorType.PENDING, label: "Created" },
};

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

export const getPollingInterval = (status: string, userSelectedInterval: number): number =>
  userSelectedInterval;
