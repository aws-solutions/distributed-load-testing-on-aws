// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AxiosResponse } from "axios";

interface TaskConfig {
  concurrency: string;
  taskCount: string;
  region: string;
}

interface ExecutionStep {
  "ramp-up": string;
  "hold-for": string;
  scenario: string;
}

interface Request {
  url: string;
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

interface TestScenario {
  execution: ExecutionStep[];
  scenarios: {
    [key: string]: {
      requests?: Request[];
      script?: string;
    };
  };
}

interface RegionalTaskDetails {
  [key: string]: {
    vCPULimit: number;
    vCPUsPerTask: number;
    vCPUsInUse: number;
    dltTaskLimit: number;
    dltAvailableTasks: number;
  };
}

export interface ScenarioRequest {
  testName: string;
  testDescription: string;
  showLive: boolean;
  testType: string;
  fileType: string;
  testTaskConfigs: TaskConfig[];
  testScenario: TestScenario;
  regionalTaskDetails: RegionalTaskDetails;
  testId?: string;
  recurrence?: string;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleStep?: string;
}

export interface ScenarioResponse extends AxiosResponse {
  testId: string;
  testName: string;
}
