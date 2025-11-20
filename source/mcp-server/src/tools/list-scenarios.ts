// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import { AppError } from "../lib/errors";
import { IAMHttpClient, type HttpResponse } from "../lib/http-client";

// Zod schema for list_scenarios parameters (empty object)
export const ListScenariosSchema = z.object({});

// TypeScript type derived from Zod schema
export type ListScenariosParameters = z.infer<typeof ListScenariosSchema>;

/**
 * Handle list_scenarios tool
 */
export async function handleListScenarios(httpClient: IAMHttpClient, apiEndpoint: string, event: AgentCoreEvent): Promise<any> {
  parseEventWithSchema(ListScenariosSchema, event);
  
  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios`);
  } catch (error) {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  const data = JSON.parse(response.body);
  if (!data) {
    throw new AppError("No scenarios found", 404);
  }

  return data;
}
