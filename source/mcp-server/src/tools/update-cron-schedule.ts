// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { cronExpressionSchema, recurrenceSchema, scheduleDateSchema, scheduleTimezoneSchema } from "@amzn/dlt-common";
import { z } from "zod";
import { BaseExistingScenarioSchema, parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import type { IHttpClient } from "../lib/http-client";
import { buildScenarioPayload, fetchRegionalTaskDetails, postScenario } from "../lib/scenario-helpers";

export const UpdateCronScheduleSchema = BaseExistingScenarioSchema.extend({
  cron_value: cronExpressionSchema,
  recurrence: recurrenceSchema,
  cron_expiry_date: scheduleDateSchema.optional(),
  schedule_timezone: scheduleTimezoneSchema.optional().default("UTC"),
});

export type UpdateCronScheduleParameters = z.infer<typeof UpdateCronScheduleSchema>;

export async function handleUpdateCronSchedule(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const params = parseEventWithSchema(UpdateCronScheduleSchema, event);

  const regionalTaskDetails = await fetchRegionalTaskDetails(httpClient, apiEndpoint);
  const payload = buildScenarioPayload(params, regionalTaskDetails, { scheduleStep: "create" });

  return postScenario(httpClient, apiEndpoint, payload);
}
