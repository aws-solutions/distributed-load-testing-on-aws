// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sub } from "date-fns";
import { randomSentence, randomWord } from "./test-data-random-utils";

// Functions to generate random test data for unit tests and early stage UI development

export interface ScenarioItem {
  startTime: string;
  testDescription: string;
  scheduleRecurrence: string;
  testId: string;
  status: "complete" | "running" | "failed" | "pending";
  testName: string;
  cronValue: string;
  nextRun: string;
}

/**
 *
 * @param data
 */
export function generateTestScenario(data?: Partial<ScenarioItem>): ScenarioItem {
  const testId = Math.random().toString(36).substring(2, 12); // Generate random 10-char ID
  const startTime = sub(new Date(), {
    days: Math.floor(Math.random() * 30),
    hours: Math.floor(Math.random() * 24),
  });

  const statuses: ScenarioItem["status"][] = ["complete", "running", "failed", "pending"];
  const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

  return {
    startTime: startTime.toISOString().replace("T", " ").substring(0, 19), // Format: "2025-08-12 19:44:42"
    testDescription: randomSentence(5, 15),
    scheduleRecurrence: Math.random() > 0.7 ? "daily" : "", // 30% chance of having recurrence
    testId,
    status: randomStatus,
    testName: randomWord(2, 3).replace(" ", "_").toLowerCase(),
    cronValue: Math.random() > 0.8 ? "0 9 * * *" : "", // 20% chance of having cron
    nextRun:
      Math.random() > 0.6
        ? sub(new Date(), { days: -Math.floor(Math.random() * 7) })
            .toISOString()
            .replace("T", " ")
            .substring(0, 19)
        : "",
    ...data,
  };
}

/**
 *
 * @param length
 * @param data
 */
export function generateTestScenarios(length: number, data?: Partial<ScenarioItem>): Array<ScenarioItem> {
  return Array.from({ length }).map(() => generateTestScenario(data));
}

/**
 * Generate mock test run details data for testing and development
 */
export function generateMockTestRunDetails(): any {
  return {
    startTime: "2025-09-27 21:54:11",
    testDescription: "basic endpoint test",
    testId: "MockTestId123",
    endTime: "2025-09-27 21:56:20",
    testTaskConfigs: [
      {
        region: "us-east-1",
        taskCount: 1,
        concurrency: 1,
      },
    ],
    completeTasks: {
      "us-east-1": 1,
    },
    testType: "simple",
    status: "complete" as const,
    succPercent: "0.00",
    testRunId: "MockRunId456",
    results: {
      "us-east-1": {
        avg_lt: "0.00467",
        p0_0: "0.003",
        p99_0: "0.011",
        stdev_rt: "0.005",
        avg_ct: "0.00347",
        metricS3Location: "cloudwatch-images/MockTestId123/CloudWatchMetrics-us-east-1-2025-09-27T21:54:11.000Z",
        concurrency: "1",
        p99_9: "0.021",
        labels: [
          {
            avg_lt: "0.00467",
            p0_0: "0.003",
            p99_0: "0.011",
            stdev_rt: "0.005",
            avg_ct: "0.00347",
            label: "https://example.com/api/test-endpoint",
            concurrency: "1",
            p99_9: "0.021",
            fail: 11973,
            rc: [
              {
                count: 11973,
                code: "403",
              },
            ],
            succ: 0,
            p100_0: "0.482",
            bytes: "15097953",
            p95_0: "0.007",
            avg_rt: "0.00473",
            throughput: 11973,
            p90_0: "0.006",
            testDuration: "0",
            p50_0: "0.004",
          },
        ],
        fail: 11973,
        rc: [
          {
            count: 11973,
            code: "403",
          },
        ],
        succ: 0,
        p100_0: "0.482",
        bytes: "15097953",
        p95_0: "0.007",
        avg_rt: "0.00473",
        throughput: 11973,
        p90_0: "0.006",
        testDuration: "60",
        p50_0: "0.004",
      },
      total: {
        avg_lt: "0.00467",
        p0_0: "0.003",
        p99_0: "0.011",
        stdev_rt: "0.005",
        avg_ct: "0.00347",
        metricS3Location: "cloudwatch-images/MockTestId123/CloudWatchMetrics-total-2025-09-27T21:54:11.000Z",
        concurrency: "1",
        p99_9: "0.021",
        labels: [
          {
            avg_lt: "0.00467",
            p0_0: "0.003",
            p99_0: "0.011",
            stdev_rt: "0.005",
            avg_ct: "0.00347",
            label: "https://example.com/api/test-endpoint",
            concurrency: "1",
            p99_9: "0.021",
            fail: 11973,
            rc: [
              {
                count: 11973,
                code: "403",
              },
            ],
            succ: 0,
            p100_0: "0.482",
            bytes: "15097953",
            p95_0: "0.007",
            avg_rt: "0.00473",
            throughput: 11973,
            p90_0: "0.006",
            testDuration: "0",
            p50_0: "0.004",
          },
        ],
        fail: 11973,
        rc: [
          {
            count: 11973,
            code: "403",
          },
        ],
        succ: 0,
        p100_0: "0.482",
        bytes: "15097953",
        p95_0: "0.007",
        avg_rt: "0.00473",
        throughput: 11973,
        p90_0: "0.006",
        testDuration: "60",
        p50_0: "0.004",
      },
    },
    testScenario: {
      execution: [
        {
          taskCount: 1,
          "hold-for": "1m",
          scenario: "basic endpoint test",
          "ramp-up": "0m",
          concurrency: 1,
        },
      ],
      reporting: [
        {
          summary: true,
          "dump-xml": "/tmp/artifacts/results.xml",
          percentiles: true,
          "test-duration": true,
          "summary-labels": true,
          module: "final-stats",
        },
      ],
      scenarios: {
        "basic endpoint test": {
          requests: [
            {
              headers: {},
              method: "GET",
              body: "{}",
              url: "https://example.com/api/test-endpoint",
            },
          ],
        },
      },
    },
  };
}
