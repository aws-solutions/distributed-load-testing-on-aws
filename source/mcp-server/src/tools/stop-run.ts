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

export const StopRunSchema = BaseTestIdSchema;

export type StopRunParameters = z.infer<typeof StopRunSchema>;

export async function handleStopRun(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id } = parseEventWithSchema(StopRunSchema, event);

  let response: HttpResponse;
  try {
    response = await httpClient.request({ method: "POST", url: `${apiEndpoint}/scenarios/${test_id}` });
  } catch {
    throw new AppError("Internal request failed", 500);
  }

  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  return JSON.parse(response.body);
}
