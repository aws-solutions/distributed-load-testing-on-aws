// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { scheduleDateSchema, scheduleTimeSchema, scheduleTimezoneSchema } from "@amzn/dlt-common";
import { z } from "zod";
import { BaseExistingScenarioSchema, parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import type { IHttpClient } from "../lib/http-client";
import { buildScenarioPayload, fetchRegionalTaskDetails, postScenario } from "../lib/scenario-helpers";

export const UpdateSimpleScheduleSchema = BaseExistingScenarioSchema.extend({
  schedule_date: scheduleDateSchema,
  schedule_time: scheduleTimeSchema,
  schedule_timezone: scheduleTimezoneSchema.optional().default("UTC"),
});

export type UpdateSimpleScheduleParameters = z.infer<typeof UpdateSimpleScheduleSchema>;

export async function handleUpdateSimpleSchedule(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const params = parseEventWithSchema(UpdateSimpleScheduleSchema, event);

  const regionalTaskDetails = await fetchRegionalTaskDetails(httpClient, apiEndpoint);
  const payload = buildScenarioPayload(params, regionalTaskDetails, { scheduleStep: "start" });

  return postScenario(httpClient, apiEndpoint, payload);
}
