// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { BaseScenarioSchema, parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import { AppError } from "../lib/errors";
import type { IHttpClient } from "../lib/http-client";
import { buildScenarioPayload, fetchRegionalTaskDetails, postScenario } from "../lib/scenario-helpers";

export const CreateTestSchema = BaseScenarioSchema;

export type CreateTestParameters = z.infer<typeof CreateTestSchema>;

export async function handleCreateTest(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const params = parseEventWithSchema(CreateTestSchema, event);

  if (params.test_type !== "simple" && !params.test_id) {
    throw new AppError(
      "test_id is required for script-based tests (jmeter, k6, locust). Call upload_test_script first to obtain a test_id.",
      400
    );
  }

  const regionalTaskDetails = await fetchRegionalTaskDetails(httpClient, apiEndpoint);
  const payload = buildScenarioPayload(params, regionalTaskDetails, { saveOnly: true });

  return postScenario(httpClient, apiEndpoint, payload);
}
