// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { parseEventWithSchema, TEST_RUN_ID_LENGTH, TEST_RUN_ID_REGEX, TEST_SCENARIO_ID_LENGTH, TEST_SCENARIO_ID_REGEX, type AgentCoreEvent } from "../lib/common";
import { AppError } from "../lib/errors";
import { IAMHttpClient, type HttpResponse } from "../lib/http-client";

// Zod schema for get_test_run parameters
export const GetTestRunSchema = z.object({
  test_id: z.string()
    .length(TEST_SCENARIO_ID_LENGTH, `test_id should be the ${TEST_SCENARIO_ID_LENGTH} character unique id for a test scenario`)
    .regex(TEST_SCENARIO_ID_REGEX, "Invalid test_id"),
  test_run_id: z.string()
    .length(TEST_RUN_ID_LENGTH, `test_run_id should be the ${TEST_RUN_ID_LENGTH} character unique id for a test run`)
    .regex(TEST_RUN_ID_REGEX, "Invalid test_run_id")
});

// TypeScript type derived from Zod schema
export type GetTestRunParameters = z.infer<typeof GetTestRunSchema>;

/**
 * Handle get_test_run tool
 */
export async function handleGetTestRun(httpClient: IAMHttpClient, apiEndpoint: string, event: AgentCoreEvent): Promise<any> {
  const { test_id, test_run_id } = parseEventWithSchema(GetTestRunSchema, event);
  
  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios/${test_id}/testruns/${test_run_id}`);
  } catch (error) {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const data = JSON.parse(response.body);
  if (!data) {
    throw new AppError(`Test run not found: ${test_id}/${test_run_id}`, 404);
  }

  return data;
}
