// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { BaseExistingScenarioSchema, parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import type { IHttpClient } from "../lib/http-client";
import { buildScenarioPayload, fetchRegionalTaskDetails, fetchScenario, postScenario } from "../lib/scenario-helpers";

export const UpdateTestSchema = BaseExistingScenarioSchema;

export type UpdateTestParameters = z.infer<typeof UpdateTestSchema>;

export async function handleUpdateTest(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const params = parseEventWithSchema(UpdateTestSchema, event);

  // update_test must target an existing test. POST /scenarios is an upsert, so
  // without this existence check an unknown test_id would silently create a new
  // scenario instead of failing (see get_scenario_details for the same pattern).
  await fetchScenario(httpClient, apiEndpoint, params.test_id, `Test not found: ${params.test_id}`);

  const regionalTaskDetails = await fetchRegionalTaskDetails(httpClient, apiEndpoint);
  const payload = buildScenarioPayload(params, regionalTaskDetails, { saveOnly: true });

  return postScenario(httpClient, apiEndpoint, payload);
}
