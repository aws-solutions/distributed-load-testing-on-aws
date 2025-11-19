// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// This file contains msw mocks of API endpoints.
// the mocks can be used for unit tests, as well as local development as long as no backend is available

import { delay, http, HttpResponse } from "msw";
import { generateMockTestRunDetails, generateTestScenarios, ScenarioItem } from "../__tests__/test-data-factory";
import { ApiEndpoints } from "../store/solutionApi.ts";

/**
 * Return a 200 OK http response with the given payload.
 * Delays the response by 200ms to simulate realistic latency and allow
 * to test a loading spinner etc on the UI.
 *
 * @param payload
 * @param delayMilliseconds
 */
export const ok = async (payload: object | object[], delayMilliseconds: number = 200) => {
  await delay(delayMilliseconds);
  return HttpResponse.json(payload, {
    status: 200,
    headers: [["Access-Control-Allow-Origin", "*"]],
  });
};

export const getScenariosHandler = (apiUrl: string) =>
  http.get(apiUrl + ApiEndpoints.SCENARIOS, async ({ request }) => {
    console.log("🎭 MSW intercepted request:", {
      url: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    });
    console.log("🎭 Returning mock scenarios data");

    // Return response in the correct schema format
    const mockResponse = {
      Items: mockScenarios,
    };

    return ok(mockResponse);
  });

export const getUserSelfHandler = (apiUrl: string) =>
  http.get(apiUrl + ApiEndpoints.USER, () => ok({ alias: "john_doe" }));

export const getRegionsHandler = (apiUrl: string) =>
  http.get(apiUrl + ApiEndpoints.REGIONS, () => {
    const mockResponse = {
      regions: [
        {
          ecsCloudWatchLogGroup: "distributed-load-testing-on-aws-DLTEcsDLTCloudWatchLogsGroupFE9EC144-5ursXtm2Gwvb",
          taskCluster: "distributed-load-testing-on-aws",
          testId: "region-us-east-1",
          taskDefinition:
            "arn:aws:ecs:us-east-1:123456789012:task-definition/distributedloadtestingonawsDLTEcsDLTTaskDefinitionFFD96F9E:12",
          subnetB: "subnet-0036b9d0136bf8b72",
          region: "us-east-1",
          taskImage: "distributed-load-testing-on-aws-load-tester",
          subnetA: "subnet-0f0e5e5b70565bac9",
          taskSecurityGroup: "sg-07e2c9237da3d7255",
        },
      ],
      url: "https://s3.us-east-1.amazonaws.com/distributed-load-testing--dlttestrunnerstoragedlts-abcdefghijkl/regional-template/distributed-load-testing-on-aws-regional.template",
    };
    return ok(mockResponse);
  });

export const getScenarioDetailsHandler = (apiUrl: string) =>
  http.get(apiUrl + ApiEndpoints.SCENARIOS + "/:testId", () => ok(mockScenarioDetails));

export const getVCPUDetailsHandler = (apiUrl: string) =>
  http.get(apiUrl + "/vCPUDetails", () => {
    const mockResponse = {
      "us-east-1": {
        vCPULimit: 4000,
        vCPUsPerTask: 2,
        vCPUsInUse: 2,
      },
      "us-west-1": {
        vCPULimit: 4000,
        vCPUsPerTask: 2,
        vCPUsInUse: 4,
      },
    };
    return ok(mockResponse);
  });

export const getTasksHandler = (apiUrl: string) =>
  http.get(apiUrl + "/tasks", () => {
    const mockResponse = [
      {
        region: "us-east-1",
        taskArns: [
          "arn:aws:ecs:us-east-1:719420829223:task/distributed-load-testing-on-aws/3750ba41b41940aeb043ec114fc0fc8f",
        ],
      },
      {
        region: "us-west-1",
        taskArns: [
          "arn:aws:ecs:us-west-1:719420829223:task/distributed-load-testing-on-aws/3750ba41b419467856743c114fc0fc8f",
          "arn:aws:ecs:us-west-1:719420829223:task/distributed-load-testing-on-aws/baa30aaf9fc5d0a530d34ab2cc153392",
        ],
      },
    ];
    return ok(mockResponse);
  });

export const getTestRunDetailsHandler = (apiUrl: string) =>
  http.get(apiUrl + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", async ({ params, request }) => {
    return ok(generateMockTestRunDetails());
  });

/**
 * @param apiUrl the base url for http requests. only requests to this base url will be intercepted and handled by mock-service-worker.
 */
export const handlers = (apiUrl: string) => [
  getUserSelfHandler(apiUrl),
  getScenariosHandler(apiUrl),
  getScenarioDetailsHandler(apiUrl),
  getTestRunDetailsHandler(apiUrl),
  getRegionsHandler(apiUrl),
  getVCPUDetailsHandler(apiUrl),
  getTasksHandler(apiUrl),
];

export const mockScenarios: ScenarioItem[] = generateTestScenarios(5); // Generate 5 mock scenarios

export const mockScenarioDetails = {
  showLive: false,
  testTaskConfigs: [
    {
      region: "us-east-1",
      taskCount: 100,
      concurrency: 10,
    },
    {
      region: "us-east-2",
      taskCount: 800,
      concurrency: 30,
    },
  ],
  status: "scheduled" as const,
  testType: "jmeter",
  nextRun: "2025-09-09 08:00:00",
  startTime: "",
  scheduleRecurrence: "",
  testDescription: "my description",
  endTime: "",
  testId: "Ic4PBihoJY",
  cronExpiryDate: "",
  results: {},
  testName: "testname01",
  cronValue: "",
  fileType: "script",
  testScenario: {
    execution: [
      {
        "ramp-up": "10m",
        "hold-for": "10m",
        scenario: "testname01",
      },
    ],
    scenarios: {
      testname01: {
        script: "Ic4PBihoJY.jmx",
      },
    },
  },
  tasksPerRegion: [
    {
      region: "us-east-1",
      tasks: [
        {
          lastStatus: "RUNNING" as const,
        },
      ],
    },
    {
      region: "us-east-2",
      tasks: [
        {
          lastStatus: "PENDING" as const,
        },
        {
          lastStatus: "PROVISIONING" as const,
        },
      ],
    },
  ],
  history: [],
};
