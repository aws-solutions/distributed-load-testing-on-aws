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
import { fetchRegionalTaskDetails } from "../lib/scenario-helpers";

export const StartRunSchema = BaseTestIdSchema;

export type StartRunParameters = z.infer<typeof StartRunSchema>;

export async function handleStartRun(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id } = parseEventWithSchema(StartRunSchema, event);

  // Fetch stored test configuration
  let scenarioResponse: HttpResponse;
  try {
    scenarioResponse = await httpClient.get(`${apiEndpoint}/scenarios/${test_id}`);
  } catch {
    throw new AppError("Failed to fetch test configuration", 500);
  }

  if (scenarioResponse.statusCode !== 200) {
    throw new AppError(scenarioResponse.body, scenarioResponse.statusCode);
  }

  const scenario = JSON.parse(scenarioResponse.body) as Record<string, unknown>;

  // Pre-fetch regional task details
  const regionalTaskDetails = await fetchRegionalTaskDetails(httpClient, apiEndpoint);

  // Build payload from specific fields (matching the UI's runScenario behavior)
  const payload: Record<string, unknown> = {
    testId: scenario.testId,
    testName: scenario.testName,
    testDescription: scenario.testDescription,
    testTaskConfigs: scenario.testTaskConfigs,
    testScenario: scenario.testScenario,
    testType: scenario.testType,
    fileType: scenario.fileType || "",
    showLive: scenario.showLive || false,
    regionalTaskDetails,
    tags: scenario.tags || [],
    ...(scenario.healthyThreshold !== undefined && { healthyThreshold: scenario.healthyThreshold }),
    ...(scenario.nativeRunMode != null && { nativeRunMode: scenario.nativeRunMode }),
  };

  let response: HttpResponse;
  try {
    response = await httpClient.request({
      method: "POST",
      url: `${apiEndpoint}/scenarios`,
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  return JSON.parse(response.body);
}
