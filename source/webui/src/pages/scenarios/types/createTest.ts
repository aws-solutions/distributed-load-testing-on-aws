// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { NativeRunMode } from "@amzn/dlt-common/validation";

export type CreateScenarioRequest = {
  testId: string | undefined;
  testName: string;
  testDescription: string;
  testTaskConfigs: TestTaskConfig[];
  testScenario: TestScenario;
  testType: "simple" | "jmeter" | "k6" | "locust";
  fileType: string | undefined;
  showLive: boolean;
  regionalTaskDetails: Record<string, RegionalTaskDetail>;
  tags: string[];
  // Scheduling Options
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleStep?: string;
  cronValue?: string;
  cronExpiryDate?: string;
  scheduleTimezone?: string;
  recurrence?: string;
  healthyThreshold?: number;
  saveOnly?: boolean;
  // Presence of nativeRunMode selects Native as the traffic-shape mode. Traffic
  // shape and test type are separate axes: a Native run still has a test type of
  // jmeter, k6, or locust. Absence of this field means Standard.
  nativeRunMode?: NativeRunMode;
};

export type TestTaskConfig = {
  concurrency: number;
  taskCount: number;
  region: string;
};

export type TestScenario = {
  execution: TestScenarioExecution[];
  scenarios: Record<string, TestScenarioSimpleDefinition | TestScenarioScriptDefinition>;
};

export type RegionalTaskDetail = {
  vCPULimit: number;
  vCPUsPerTask: number;
  vCPUsInUse: number;
  dltTaskLimit: number;
  dltAvailableTasks: number;
};

export type TestScenarioExecution = {
  // Number value appended with time unit (e.g. 30s or 2m). Native mode sends an unused placeholder.
  "ramp-up": string;
  // Number value appended with time unit (e.g. 30s or 2m). Native mode sends an unused placeholder.
  "hold-for": string;
  scenario: string;
  executor: "jmeter" | "k6" | "locust" | undefined;
};

export type TestScenarioSimpleDefinition = {
  requests: TestScenariosSimpleRequest[];
};

export type TestScenarioScriptDefinition = {
  script: string;
};

export type TestScenariosSimpleRequest = {
  url: string;
  method: string;
  headers: any;
  body?: string;
};
