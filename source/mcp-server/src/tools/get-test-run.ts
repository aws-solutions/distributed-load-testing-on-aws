// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  parseEventWithSchema,
  BaseTestRunSchema,
  type AgentCoreEvent,
} from "../lib/common";
import { AppError } from "../lib/errors";
import type { HttpResponse, IHttpClient } from "../lib/http-client";

// Zod schema for get_test_run parameters
export const GetTestRunSchema = BaseTestRunSchema;

// TypeScript type derived from Zod schema
export type GetTestRunParameters = z.infer<typeof GetTestRunSchema>;

/**
 * Handle get_test_run tool
 */
export async function handleGetTestRun(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id, test_run_id } = parseEventWithSchema(GetTestRunSchema, event);

  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios/${test_id}/testruns/${test_run_id}`);
  } catch {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const data: unknown = JSON.parse(response.body);
  if (!data) {
    throw new AppError(`Test run not found: ${test_id}/${test_run_id}`, 404);
  }

  return data;
}
