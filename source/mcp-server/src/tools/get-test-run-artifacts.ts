// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { parseEventWithSchema, TEST_RUN_ID_LENGTH, TEST_RUN_ID_REGEX, TEST_SCENARIO_ID_LENGTH, TEST_SCENARIO_ID_REGEX, type AgentCoreEvent } from "../lib/common";
import { getScenariosBucket } from "../lib/config";
import { AppError } from "../lib/errors";
import { IAMHttpClient, type HttpResponse } from "../lib/http-client";

// Zod schema for get_test_run_artifacts parameters
export const GetTestRunArtifactsSchema = z.object({
  test_id: z.string()
    .length(TEST_SCENARIO_ID_LENGTH, `test_id should be the ${TEST_SCENARIO_ID_LENGTH} character unique id for a test scenario`)
    .regex(TEST_SCENARIO_ID_REGEX, "Invalid test_id"),
  test_run_id: z.string()
    .length(TEST_RUN_ID_LENGTH, `test_run_id should be the ${TEST_RUN_ID_LENGTH} character unique id for a test run`)
    .regex(TEST_RUN_ID_REGEX, "Invalid test_run_id")
});

// TypeScript type derived from Zod schema
export type GetTestRunArtifactsParameters = z.infer<typeof GetTestRunArtifactsSchema>;

/**
 * Handle get_test_run_artifacts tool
 */
export async function handleGetTestRunArtifacts(httpClient: IAMHttpClient, apiEndpoint: string, event: AgentCoreEvent): Promise<any> {
  const { test_id, test_run_id } = parseEventWithSchema(GetTestRunArtifactsSchema, event);
  // Get test run details to extract artifact information
  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios/${test_id}/testruns/${test_run_id}`);
  } catch (error) {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const testRunData = JSON.parse(response.body);
  if (!testRunData) {
    throw new AppError(`Test run not found: ${test_id}/${test_run_id}`, 404);
  }
  
  const startTime = testRunData['startTime'];
  if (!startTime) {
    throw new AppError("Unexpected test run response", 500);
  }

  // Extract S3 bucket and path information
  const formattedStartTime = startTime.replace(' ', 'T').replace(/:/g, '-');
  const bucketName = getScenariosBucket();
  const testScenarioPath = `results/${test_id}`;
  const testRunPath = testScenarioPath + `/${formattedStartTime}_${test_run_id}`;

  return {
    bucketName,
    testRunPath,
    testScenarioPath,
    description: "Starting in v4.0.0, each test run's artifacts will have a unique path that includes a concatenated prefix of timestamp + test run id (testRunPath). Test runs prior to v4.0.0 will live in a shared path without clear separation (testScenarioPath). If testRunPath has no objects, try falling back to testScenarioPath for the legacy artifact storage behavior."
  };
}
