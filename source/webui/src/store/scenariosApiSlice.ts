// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { get, post } from "aws-amplify/api";
import { ScenarioDefinition, TestRunsResponse } from "../pages/scenarios/types";
import { CreateScenarioRequest } from "../pages/scenarios/types/createTest.ts";
import { BaselineResponse, TestRunDetails } from "../pages/scenarios/types/testResults.ts";
import { ApiEndpoints, solutionApi } from "./solutionApi.ts";

export const scenariosApiSlice = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    getScenarios: builder.query<{ Items: ScenarioDefinition[] }, void>({
      query: () => ApiEndpoints.SCENARIOS,
      providesTags: ["Scenarios"],
    }),
    createScenario: builder.mutation<ScenarioDefinition, CreateScenarioRequest>({
      query: (payload) => ({
        url: ApiEndpoints.SCENARIOS,
        method: "POST",
        body: payload,
      }),
      invalidatesTags: ["Scenarios"],
    }),
    getScenarioDetails: builder.query<ScenarioDefinition, { testId: string; includeHistory?: boolean }>({
      query: ({ testId, includeHistory = false }) => `${ApiEndpoints.SCENARIOS}/${testId}?history=${includeHistory}`,
      providesTags: (result, error, { testId }) => [{ type: "Scenarios", id: testId }],
    }),
    deleteScenario: builder.mutation<{ message: string }, string>({
      query: (testId) => ({
        url: `${ApiEndpoints.SCENARIOS}/${testId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Scenarios"],
    }),
    getTestRuns: builder.query<
      TestRunsResponse,
      {
        testId: string;
        nextToken?: string;
        startTimestamp?: string;
        endTimestamp?: string;
        limit?: number;
      }
    >({
      query: ({ testId, nextToken, startTimestamp, endTimestamp, limit = 20 }) => {
        const params = new URLSearchParams();
        params.append("limit", limit.toString());
        if (nextToken) params.append("next_token", nextToken);
        if (startTimestamp) params.append("start_timestamp", startTimestamp);
        if (endTimestamp) params.append("end_timestamp", endTimestamp);

        return `${ApiEndpoints.SCENARIOS}/${testId}/testruns?${params.toString()}`;
      },
      providesTags: (result, error, { testId }) => [
        { type: "TestRuns", id: `${testId}-all` }
      ],
    }),
    setTestRunBaseline: builder.mutation<{ message: string }, { testId: string; testRunId: string }>({
      query: ({ testId, testRunId }) => ({
        url: `${ApiEndpoints.SCENARIOS}/${testId}/baseline`,
        method: "PUT",
        body: { testRunId },
      }),
      invalidatesTags: (result, error, { testId }) => [
        { type: "TestRuns", id: `${testId}-all` },
        { type: "TestRuns", id: `${testId}-baseline` },
      ],
    }),
    removeTestRunBaseline: builder.mutation<{ message: string }, { testId: string }>({
      query: ({ testId }) => ({
        url: `${ApiEndpoints.SCENARIOS}/${testId}/baseline`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { testId }) => [
        { type: "TestRuns", id: `${testId}-all` },
        { type: "TestRuns", id: `${testId}-baseline` },
      ],
    }),
    getTestRunDetails: builder.query<TestRunDetails, { testId: string; testRunId: string }>({
      query: ({ testId, testRunId }) => `${ApiEndpoints.SCENARIOS}/${testId}/testruns/${testRunId}`,
      providesTags: (result, error, { testId, testRunId }) => [{ type: "TestRuns", id: `${testId}-${testRunId}` }],
    }),
    getBaseline: builder.query<BaselineResponse, { testId: string }>({
      query: ({ testId }) => `${ApiEndpoints.SCENARIOS}/${testId}/baseline`,
      providesTags: (result, error, { testId }) => [{ type: "TestRuns", id: `${testId}-baseline` }],
    }),
    stopScenario: builder.mutation<{ message: string }, { testId: string }>({
      query: ({ testId }) => ({
        url: `${ApiEndpoints.SCENARIOS}/${testId}`,
        method: "POST",
        body: { action: "stop" },
      }),
      invalidatesTags: (result, error, { testId }) => [{ type: "Scenarios", id: testId }],
    }),
    deleteTestRuns: builder.mutation<{ message: string }, { testId: string; testRunIds: string[] }>({
      query: ({ testId, testRunIds }) => ({
        url: `${ApiEndpoints.SCENARIOS}/${testId}/testruns`,
        method: "DELETE",
        body: testRunIds,
      }),
      invalidatesTags: (result, error, { testId }) => [
        { type: "TestRuns", id: `${testId}-all` },
        { type: "TestRuns", id: `${testId}-baseline` },
      ],
    }),
    runScenario: builder.mutation<{ message: string }, ScenarioDefinition>({
      queryFn: async (scenario) => {
        const regionalTaskDetails: any = {};

        try {
          const [vCPUResponse, tasksResponse] = await Promise.all([
            get({ apiName: "solution-api", path: "/vCPUDetails" }).response.then((r) => r.body.json()),
            get({ apiName: "solution-api", path: "/tasks" }).response.then((r) => r.body.json()),
          ]);

          const tasksByRegion = Array.isArray(tasksResponse)
            ? tasksResponse.reduce((acc: any, task: any) => {
                acc[task.region] = task.taskArns?.length || 0;
                return acc;
              }, {})
            : {};

          if (vCPUResponse && typeof vCPUResponse === 'object') {
            Object.keys(vCPUResponse).forEach((region) => {
              const vCPUData = (vCPUResponse as any)[region];
              if (vCPUData) {
                const runningTasks = tasksByRegion[region] || 0;
                const dltTaskLimit = Math.floor(vCPUData.vCPULimit / vCPUData.vCPUsPerTask);

                regionalTaskDetails[region] = {
                  vCPULimit: vCPUData.vCPULimit,
                  vCPUsPerTask: vCPUData.vCPUsPerTask,
                  vCPUsInUse: vCPUData.vCPUsInUse,
                  dltTaskLimit,
                  dltAvailableTasks: dltTaskLimit - runningTasks,
                };
              }
            });
          }
        } catch (error) {
          console.error('Failed to fetch regional task details:', error);
        }

        const payload = {
          testId: scenario.testId,
          testName: scenario.testName,
          testDescription: scenario.testDescription,
          testTaskConfigs: scenario.testTaskConfigs.map(config => ({
            concurrency: config.concurrency.toString(),
            taskCount: config.taskCount.toString(),
            region: config.region,
          })),
          testScenario: scenario.testScenario,
          testType: scenario.testType,
          fileType: scenario.fileType || "",
          showLive: scenario.showLive || false,
          regionalTaskDetails,
          tags: scenario.tags || [],
        };

        try {
          const response = await post({
            apiName: "solution-api",
            path: "/scenarios",
            options: {
              body: payload,
            },
          }).response;

          const result = await response.body.json();
          const message = result && typeof result === 'object' && 'message' in result
            ? (result as any).message
            : 'Scenario started successfully';
          return { data: { message } };
        } catch (error: any) {
          // Extract status code from Amplify error
          const statusCode = error?._response?.statusCode || error?.$metadata?.httpStatusCode || 500;
          
          // Extract and parse error message from response body
          let errorMessage = 'An error occurred';
          if (error?._response?.body) {
            try {
              errorMessage = JSON.parse(error._response.body);
            } catch {
              errorMessage = error._response.body;
            }
          }
          
          return { 
            error: { 
              status: statusCode,
              data: { message: errorMessage }
            } 
          };
        }
      },
      invalidatesTags: (result, error, scenario) => [
        { type: "Scenarios", id: scenario.testId },
        { type: "TestRuns", id: `${scenario.testId}-all` },
      ],
    }),
  }),
});

export const {
  useGetScenariosQuery,
  useCreateScenarioMutation,
  useDeleteScenarioMutation,
  useGetScenarioDetailsQuery,
  useGetTestRunsQuery,
  useSetTestRunBaselineMutation,
  useRemoveTestRunBaselineMutation,
  useGetTestRunDetailsQuery,
  useGetBaselineQuery,
  useStopScenarioMutation,
  useDeleteTestRunsMutation,
  useRunScenarioMutation,
} = scenariosApiSlice;
