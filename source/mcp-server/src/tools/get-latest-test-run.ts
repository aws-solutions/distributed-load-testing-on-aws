// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { parseEventWithSchema, TEST_SCENARIO_ID_LENGTH, TEST_SCENARIO_ID_REGEX, type AgentCoreEvent } from "../lib/common";
import { AppError } from "../lib/errors";
import { IAMHttpClient, type HttpResponse } from "../lib/http-client";

// Zod schema for get_latest_test_run parameters
export const GetLatestTestRunSchema = z.object({
  test_id: z.string()
    .length(TEST_SCENARIO_ID_LENGTH, `test_id should be the ${TEST_SCENARIO_ID_LENGTH} character unique id for a test scenario`)
    .regex(TEST_SCENARIO_ID_REGEX, "Invalid test_id")
});

// TypeScript type derived from Zod schema
export type GetLatestTestRunParameters = z.infer<typeof GetLatestTestRunSchema>;

/**
 * Handle get_latest_test_run tool
 */
export async function handleGetLatestTestRun(httpClient: IAMHttpClient, apiEndpoint: string, event: AgentCoreEvent): Promise<any> {
  const { test_id } = parseEventWithSchema(GetLatestTestRunSchema, event);
  
  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios/${test_id}/testruns?limit=1`);
  } catch (error) {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const data = JSON.parse(response.body);
  if (!data) {
    throw new AppError(`Test run data not found: ${test_id}`, 404);
  }

  const testRuns = data["testRuns"];
  if (!testRuns || testRuns.length === 0) {
    throw new AppError(`No test runs found for test_id: ${test_id}`, 404);
  }
  
  return testRuns[0];
}
