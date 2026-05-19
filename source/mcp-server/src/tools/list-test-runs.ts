// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  parseEventWithSchema,
  TEST_SCENARIO_ID_LENGTH,
  TEST_SCENARIO_ID_REGEX,
  type AgentCoreEvent,
} from "../lib/common";
import { AppError } from "../lib/errors";
import type { HttpResponse, IHttpClient } from "../lib/http-client";

// Zod schema for list_test_runs parameters
export const ListTestRunsSchema = z
  .object({
    test_id: z
      .string()
      .length(
        TEST_SCENARIO_ID_LENGTH,
        `test_id should be the ${TEST_SCENARIO_ID_LENGTH} character unique id for a test scenario`
      )
      .regex(TEST_SCENARIO_ID_REGEX, "Invalid test_id"),
    limit: z.number().int().positive().max(30, "limit must be an integer between 1 and 30").optional(),
    start_timestamp: z.iso
      .datetime("start_timestamp must be a valid ISO 8601 timestamp (e.g. 2025-10-13T16:05:42.123Z)")
      .optional(),
  })
  .refine((data) => !(data.limit && data.start_timestamp), {
    message: "Cannot use both limit and start_timestamp parameters - only one may be provided",
    path: ["limit", "start_timestamp"],
  });

// TypeScript type derived from Zod schema
export type ListTestRunsParameters = z.infer<typeof ListTestRunsSchema>;

// Zod schema for test runs API response
const TestRunsResponseSchema = z.object({
  testRuns: z.array(z.unknown()).min(1, "No test runs found"),
});

/**
 * Handle list_test_runs tool
 */
export async function handleListTestRuns(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id, limit, start_timestamp } = parseEventWithSchema(ListTestRunsSchema, event);

  // Build query parameters
  const queryParams = new URLSearchParams();
  // Limit
  if (limit !== undefined) {
    queryParams.append("limit", limit.toString());
  } else {
    queryParams.append("limit", "30");
  }
  // From Date
  if (start_timestamp !== undefined) {
    queryParams.append("start_timestamp", start_timestamp);
  }
  // To Date
  queryParams.append("end_timestamp", new Date().toISOString());

  const url = `${apiEndpoint}/scenarios/${test_id}/testruns?${queryParams.toString()}`;

  let response: HttpResponse;
  try {
    response = await httpClient.get(url);
  } catch {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const data: unknown = JSON.parse(response.body);
  const parseResult = TestRunsResponseSchema.safeParse(data);
  if (!parseResult.success) {
    throw new AppError(`No test runs found for test_id: ${test_id}`, 404);
  }

  return parseResult.data.testRuns;
}
