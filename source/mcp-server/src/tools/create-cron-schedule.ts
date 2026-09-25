// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { cronExpressionSchema, recurrenceSchema, scheduleDateSchema, scheduleTimezoneSchema } from "@amzn/dlt-common";
import { z } from "zod";
import { BaseScenarioSchema, parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import type { IHttpClient } from "../lib/http-client";
import { buildScenarioPayload, fetchRegionalTaskDetails, postScenario } from "../lib/scenario-helpers";

export const CreateCronScheduleSchema = BaseScenarioSchema.extend({
  cron_value: cronExpressionSchema,
  recurrence: recurrenceSchema,
  cron_expiry_date: scheduleDateSchema.optional(),
  schedule_timezone: scheduleTimezoneSchema.optional().default("UTC"),
});

export type CreateCronScheduleParameters = z.infer<typeof CreateCronScheduleSchema>;

export async function handleCreateCronSchedule(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const params = parseEventWithSchema(CreateCronScheduleSchema, event);

  const regionalTaskDetails = await fetchRegionalTaskDetails(httpClient, apiEndpoint);
  const payload = buildScenarioPayload(params, regionalTaskDetails, { scheduleStep: "create" });

  return postScenario(httpClient, apiEndpoint, payload);
}
