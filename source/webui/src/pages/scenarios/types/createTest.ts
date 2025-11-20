// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

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
  recurrence?: string;
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
  // number value appended with time unit (e.g. 30s or 2m)
  "ramp-up": string;
  // number value appended with time unit (e.g. 30s or 2m)
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
