// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  parseEventWithSchema,
  BaseTestRunSchema,
  type AgentCoreEvent,
} from "../lib/common";
import { getScenariosBucket } from "../lib/config";
import { AppError } from "../lib/errors";
import type { HttpResponse, IHttpClient } from "../lib/http-client";

// Zod schema for get_test_run_artifacts parameters
export const GetTestRunArtifactsSchema = BaseTestRunSchema;

// TypeScript type derived from Zod schema
export type GetTestRunArtifactsParameters = z.infer<typeof GetTestRunArtifactsSchema>;

// Zod schema for test run API response
const TestRunResponseSchema = z.object({
  startTime: z.string(),
});

/**
 * Handle get_test_run_artifacts tool
 */
export async function handleGetTestRunArtifacts(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id, test_run_id } = parseEventWithSchema(GetTestRunArtifactsSchema, event);
  // Get test run details to extract artifact information
  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios/${test_id}/testruns/${test_run_id}`);
  } catch {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const testRunData: unknown = JSON.parse(response.body);

  // If response is null/empty, the test run doesn't exist (customer error)
  if (!testRunData) {
    throw new AppError(`Test run not found: ${test_id}/${test_run_id}`, 404);
  }

  // If response exists but is malformed, it's an internal error
  const parseResult = TestRunResponseSchema.safeParse(testRunData);
  if (!parseResult.success) {
    throw new AppError("Internal request failed", 500);
  }

  const { startTime } = parseResult.data;

  // Extract S3 bucket and path information
  const formattedStartTime = startTime.replace(" ", "T").replaceAll(":", "-");
  const bucketName = getScenariosBucket();
  const testScenarioPath = `results/${test_id}`;
  const testRunPath = testScenarioPath + `/${formattedStartTime}_${test_run_id}`;

  return {
    bucketName,
    testRunPath,
    testScenarioPath,
    description:
      "Starting in v4.0.0, each test run's artifacts will have a unique path that includes a concatenated prefix of timestamp + test run id (testRunPath). Test runs prior to v4.0.0 will live in a shared path without clear separation (testScenarioPath). If testRunPath has no objects, try falling back to testScenarioPath for the legacy artifact storage behavior.",
  };
}
