// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import { AppError } from "../lib/errors";
import type { IHttpClient } from "../lib/http-client";
import guides from "../workflows/guides.json";

const VALID_WORKFLOWS = [
  "run_and_monitor",
  "baseline_comparison",
  "schedule_test",
  "create_and_run",
  "create_native_and_run",
  "update_and_run",
] as const;

export const GetWorkflowGuidesSchema = z.object({
  workflow: z.enum(VALID_WORKFLOWS),
});

export type GetWorkflowGuidesParameters = z.infer<typeof GetWorkflowGuidesSchema>;

export async function handleGetWorkflowGuides(
  _httpClient: IHttpClient,
  _apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { workflow } = parseEventWithSchema(GetWorkflowGuidesSchema, event);

  const guide = (guides as Record<string, unknown>)[workflow];
  if (!guide) {
    throw new AppError(`Unknown workflow: ${workflow}`, 400);
  }

  return guide;
}
