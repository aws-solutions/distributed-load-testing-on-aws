// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared helpers for write tools that proxy to POST /scenarios.
 * - fetchRegionalTaskDetails: pre-fetches vCPU limits and running task counts
 *   required by the API to validate task capacity before creating/running tests.
 * - buildScenarioPayload: transforms agent-facing snake_case parameters to the
 *   camelCase format expected by the DLT API, and injects server-side fields
 *   (fileType, regionalTaskDetails, saveOnly, scheduleStep) that agents don't provide.
 */
import { createTestSchema, fileTypeForAssetFilename } from "@amzn/dlt-common";
import type { FileType, NativeRunMode } from "@amzn/dlt-common";
import { z } from "zod";
import { AppError } from "./errors";
import type { HttpResponse, IHttpClient } from "./http-client";

// Scenario records always come back as objects; testType is the only field the
// write tools inspect. looseObject keeps every other field so callers that
// return the whole record (e.g. get_scenario_details) are unaffected.
const ScenarioBodySchema = z.looseObject({ testType: z.string().optional() });

export type ScenarioBody = z.infer<typeof ScenarioBodySchema>;

/**
 * Fetches a scenario record via GET /scenarios/{id}, guarding both the HTTP call
 * and the JSON parse so every failure surfaces as an AppError instead of a raw
 * SyntaxError. Throws 404 (with notFoundMessage) when the API reports no such
 * test, otherwise returns the validated record.
 */
export async function fetchScenario(
  httpClient: IHttpClient,
  apiEndpoint: string,
  testId: string,
  notFoundMessage: string
): Promise<ScenarioBody> {
  let response: HttpResponse;
  try {
    response = await httpClient.get(`${apiEndpoint}/scenarios/${testId}?history=false&latest=false`);
  } catch {
    throw new AppError("Internal request failed", 500);
  }
  if (response.statusCode !== 200) {
    throw new AppError(response.body, response.statusCode);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new AppError("Unexpected response format", 500);
  }
  if (!parsed) {
    throw new AppError(notFoundMessage, 404);
  }

  const result = ScenarioBodySchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError("Unexpected response format", 500);
  }
  return result.data;
}

/**
 * Posts a built scenario payload to the DLT API and returns the parsed response.
 * Shared by the create/update test and schedule write tools.
 */
export async function postScenario(
  httpClient: IHttpClient,
  apiEndpoint: string,
  payload: Record<string, unknown>
): Promise<unknown> {
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

export interface RegionalTaskDetail {
  vCPULimit: number;
  vCPUsPerTask: number;
  vCPUsInUse: number;
  dltTaskLimit: number;
  dltAvailableTasks: number;
}

export type RegionalTaskDetails = Record<string, RegionalTaskDetail>;

export async function fetchRegionalTaskDetails(
  httpClient: IHttpClient,
  apiEndpoint: string
): Promise<RegionalTaskDetails> {
  let vCPUResponse: HttpResponse;
  let tasksResponse: HttpResponse;
  try {
    [vCPUResponse, tasksResponse] = await Promise.all([
      httpClient.get(`${apiEndpoint}/vCPUDetails`),
      httpClient.get(`${apiEndpoint}/tasks`),
    ]);
  } catch {
    throw new AppError("Failed to fetch regional task details", 500);
  }

  if (vCPUResponse.statusCode !== 200) {
    throw new AppError("Failed to fetch vCPU details", 500);
  }
  if (tasksResponse.statusCode !== 200) {
    throw new AppError("Failed to fetch task details", 500);
  }

  const vCPUDetails = JSON.parse(vCPUResponse.body) as Record<string, { vCPULimit: number; vCPUsPerTask: number; vCPUsInUse: number }>;
  const tasks = JSON.parse(tasksResponse.body) as Array<{ region: string; taskArns?: string[] }>;

  const tasksByRegion: Record<string, number> = Array.isArray(tasks)
    ? tasks.reduce((acc: Record<string, number>, task) => {
        acc[task.region] = task.taskArns?.length || 0;
        return acc;
      }, {})
    : {};

  const regionalTaskDetails: RegionalTaskDetails = {};
  for (const [region, vCPUData] of Object.entries(vCPUDetails)) {
    if (vCPUData) {
      const runningTasks = tasksByRegion[region] || 0;
      const dltTaskLimit = Math.floor(vCPUData.vCPULimit / vCPUData.vCPUsPerTask);
      regionalTaskDetails[region] = {
        vCPULimit: vCPUData.vCPULimit,
        vCPUsPerTask: vCPUData.vCPUsPerTask,
        vCPUsInUse: vCPUData.vCPUsInUse,
        dltTaskLimit,
        dltAvailableTasks: dltTaskLimit - runningTasks,
      };
    }
  }

  return regionalTaskDetails;
}

interface TaskConfig {
  region: string;
  task_count: number;
  concurrency: number;
}

interface ScenarioPayloadOptions {
  saveOnly?: boolean;
  scheduleStep?: string;
}

export interface ScenarioInput {
  test_id?: string | undefined;
  test_name: string;
  test_description: string;
  test_type: string;
  test_task_configs: TaskConfig[];
  test_scenario: Record<string, unknown>;
  show_live?: boolean | undefined;
  tags?: string[] | undefined;
  healthy_threshold?: number | undefined;
  native_run_mode?: NativeRunMode | undefined;
  schedule_date?: string | undefined;
  schedule_time?: string | undefined;
  schedule_timezone?: string | undefined;
  cron_value?: string | undefined;
  recurrence?: string | undefined;
  cron_expiry_date?: string | undefined;
}

/**
 * The UI expects testScenario.scenarios to be keyed by testName,
 * execution[].scenario to reference that same key, and script-based tests
 * to declare their Taurus executor (Taurus defaults to jmeter otherwise,
 * which cannot run locust/k6 scripts). Normalize all three so MCP-created
 * tests are consistent with UI-created ones.
 */
function normalizeScenarioKeys(
  testScenario: Record<string, unknown>,
  testName: string,
  testType: string
): Record<string, unknown> {
  const result = { ...testScenario };

  const scenarios = result["scenarios"];
  if (scenarios && typeof scenarios === "object" && !Array.isArray(scenarios)) {
    const keys = Object.keys(scenarios);
    if (keys.length === 1 && keys[0] !== testName) {
      const scenarioData = (scenarios as Record<string, unknown>)[keys[0]];
      result["scenarios"] = { [testName]: scenarioData };
    }
  }

  const execution = result["execution"];
  if (Array.isArray(execution) && execution.length > 0) {
    result["execution"] = execution.map((entry: Record<string, unknown>) => ({
      ...entry,
      scenario: testName,
      ...(testType !== "simple" && { executor: testType }),
    }));
  }

  return result;
}

/**
 * Derive the API `fileType` for a scenario.
 *
 * Simple (inline) tests carry no asset ("none"). Script-based tests reference
 * their uploaded asset by filename in `test_scenario.scenarios[*].script` (the
 * `script_filename` returned by upload_test_script, e.g. "abc123.zip"). A ".zip"
 * asset must be declared as "zip" so the API's asset check looks for the zip
 * object in S3 rather than a bare script (jmx/js/py); otherwise a zip upload is
 * sent as "script", the asset check fails with 400, and the uploaded zip is left
 * orphaned in the bucket. The zip-vs-script decision is delegated to the shared
 * asset-key contract so it cannot drift from what the API and task runner expect.
 * A scenario with no referenced script filename falls back to "script".
 */
function deriveFileType(params: ScenarioInput): FileType {
  if (params.test_type === "simple") {
    return "none";
  }

  const scenarios = params.test_scenario["scenarios"];
  if (scenarios && typeof scenarios === "object" && !Array.isArray(scenarios)) {
    for (const entry of Object.values(scenarios as Record<string, unknown>)) {
      const script = entry && typeof entry === "object" ? (entry as Record<string, unknown>)["script"] : undefined;
      if (typeof script === "string") {
        return fileTypeForAssetFilename(script);
      }
    }
  }

  return "script";
}

export function buildScenarioPayload(
  params: ScenarioInput,
  regionalTaskDetails: RegionalTaskDetails,
  options: ScenarioPayloadOptions = {}
): Record<string, unknown> {
  const fileType = deriveFileType(params);

  const payload: Record<string, unknown> = {};
  payload["testId"] = params.test_id;
  payload["testName"] = params.test_name;
  payload["testDescription"] = params.test_description;
  payload["testType"] = params.test_type;
  payload["fileType"] = fileType;
  payload["testTaskConfigs"] = params.test_task_configs.map((c) => ({
    region: c.region,
    taskCount: c.task_count,
    concurrency: c.concurrency,
  }));
  payload["testScenario"] = normalizeScenarioKeys(params.test_scenario, params.test_name, params.test_type);
  payload["showLive"] = params.show_live ?? false;
  payload["regionalTaskDetails"] = regionalTaskDetails;

  if (params.tags) {
    payload["tags"] = params.tags;
  }
  if (params.healthy_threshold !== undefined) {
    payload["healthyThreshold"] = params.healthy_threshold;
  }
  if (params.native_run_mode !== undefined) {
    payload["nativeRunMode"] = params.native_run_mode;
  }
  if (options.saveOnly) {
    payload["saveOnly"] = true;
  }
  if (options.scheduleStep) {
    payload["scheduleStep"] = options.scheduleStep;
  }
  if (params.schedule_date) {
    payload["scheduleDate"] = params.schedule_date;
  }
  if (params.schedule_time) {
    payload["scheduleTime"] = params.schedule_time;
  }
  if (params.schedule_timezone) {
    payload["scheduleTimezone"] = params.schedule_timezone;
  }
  if (params.cron_value) {
    payload["cronValue"] = params.cron_value;
  }
  if (params.recurrence) {
    payload["recurrence"] = params.recurrence;
  }
  if (params.cron_expiry_date) {
    payload["cronExpiryDate"] = params.cron_expiry_date;
  }

  // Validate the assembled payload against the shared create schema before POST (same
  // contract the API and CLI enforce), so bad input fails fast with a clear error.
  const validation = createTestSchema.safeParse(payload);
  if (!validation.success) {
    const message = validation.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new AppError(`Invalid scenario request: ${message}`, 400);
  }

  return payload;
}
