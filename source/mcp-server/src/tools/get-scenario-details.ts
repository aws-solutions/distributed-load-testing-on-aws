// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  parseEventWithSchema,
  BaseTestIdSchema,
  type AgentCoreEvent,
} from "../lib/common";
import type { IHttpClient } from "../lib/http-client";
import { fetchScenario } from "../lib/scenario-helpers";

// Zod schema for get_scenario_details parameters
export const GetScenarioDetailsSchema = BaseTestIdSchema;

// TypeScript type derived from Zod schema
export type GetScenarioDetailsParameters = z.infer<typeof GetScenarioDetailsSchema>;

/**
 * Handle get_scenario_details tool
 */
export async function handleGetScenarioDetails(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id } = parseEventWithSchema(GetScenarioDetailsSchema, event);

  return fetchScenario(httpClient, apiEndpoint, test_id, `Scenario not found: ${test_id}`);
}
