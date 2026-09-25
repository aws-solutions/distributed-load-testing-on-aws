// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  parseEventWithSchema,
  BaseTestIdSchema,
  type AgentCoreEvent,
} from "../lib/common";
import { AppError } from "../lib/errors";
import type { HttpResponse, IHttpClient } from "../lib/http-client";

// Zod schema for get_baseline_test_run parameters
export const GetBaselineTestRunSchema = BaseTestIdSchema;

// TypeScript type derived from Zod schema
export type GetBaselineTestRunParameters = z.infer<typeof GetBaselineTestRunSchema>;

/**
 * Handle get_baseline_test_run tool
 */
export async function handleGetBaselineTestRun(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id } = parseEventWithSchema(GetBaselineTestRunSchema, event);

  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios/${test_id}/baseline`);
  } catch {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const data: unknown = JSON.parse(response.body);
  if (!data) {
    throw new AppError(`Baseline test run not found: ${test_id}`, 404);
  }

  return data;
}
