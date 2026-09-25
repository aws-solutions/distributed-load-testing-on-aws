// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TestScenarioValidation } from "@amzn/dlt-common/validation";
import { TestMode, VALIDATION_LIMITS } from "../pages/scenarios/constants";
import { createEmptyNativeModeInput } from "../pages/scenarios/hooks/useFormData";
import type { DurationUnit } from "../pages/scenarios/types";
import { fromSeconds, parseStoredDuration } from "../pages/scenarios/utils/duration";
import { generateUniqueId } from "./generateUniqueId";

type StoredExecution = TestScenarioValidation["execution"][number];

type StandardModeFields = {
  rampUpValue: string;
  rampUpUnit: DurationUnit;
  holdForValue: string;
  holdForUnit: DurationUnit;
};

const getBodyPayload = (body: any): string => {
  if (!body) return "";
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed === "{}" || trimmed === "") return "";
    return body;
  }
  if (typeof body === "object" && Object.keys(body).length === 0) return "";
  return JSON.stringify(body, null, 2);
};

const getScheduleFields = (scenario: any) => {
  let executionTiming = "run-now";
  let scheduleTime = "";
  let scheduleDate = "";
  let cronMinutes = "";
  let cronHours = "";
  let cronDayOfMonth = "";
  let cronMonth = "";
  let cronDayOfWeek = "";
  let cronExpiryDate = "";
  let scheduleTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  if (scenario.cronValue && typeof scenario.cronValue === "string") {
    executionTiming = "run-schedule";
    const cronParts = scenario.cronValue.split(" ");
    if (cronParts.length >= 5) {
      [cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek] = cronParts;
    }
    cronExpiryDate = scenario.cronExpiryDate || "";
    scheduleTimezone = scenario.scheduleTimezone || "UTC";
  } else if (scenario.scheduleDate && scenario.scheduleTime) {
    executionTiming = "run-once";
    scheduleDate = scenario.scheduleDate;
    scheduleTime = scenario.scheduleTime;
    scheduleTimezone = scenario.scheduleTimezone || "UTC";
  }

  return {
    executionTiming,
    scheduleTime,
    scheduleDate,
    cronMinutes,
    cronHours,
    cronDayOfMonth,
    cronMonth,
    cronDayOfWeek,
    cronExpiryDate,
    scheduleTimezone,
  };
};

const getNativeModeFields = (nativeRunMode: any) => {
  const nativeMode = createEmptyNativeModeInput();
  // Hydrate the saved safety duration; a native scenario missing it falls back to
  // the default (4 hours). fromSeconds preserves whole hours (7200s → 2h).
  const maxDuration =
    Number(nativeRunMode?.maxTestDurationSeconds) > 0
      ? fromSeconds(Number(nativeRunMode.maxTestDurationSeconds))
      : nativeMode.maxDuration;

  return { nativeMode: { maxDuration } };
};

const getStandardModeFields = (execution: StoredExecution | undefined, isNativeMode: boolean): StandardModeFields => {
  if (isNativeMode) {
    return {
      rampUpValue: "",
      rampUpUnit: "minutes",
      holdForValue: "",
      holdForUnit: "minutes",
    };
  }

  const rampUp = parseStoredDuration(execution?.["ramp-up"]);
  const holdFor = parseStoredDuration(execution?.["hold-for"]);

  return {
    rampUpValue: rampUp?.value ?? "",
    rampUpUnit: rampUp?.unit ?? "minutes",
    holdForValue: holdFor?.value ?? "",
    holdForUnit: holdFor?.unit ?? "minutes",
  };
};

const getRequestHeaders = (headers: any): string =>
  headers && typeof headers === "object" && Object.keys(headers).length > 0 ? JSON.stringify(headers, null, 2) : "";

const getRegions = (testTaskConfigs: any[] | undefined, isNativeMode: boolean) =>
  testTaskConfigs?.map((config: any) => ({
    region: config.region,
    taskCount: config.taskCount?.toString() || "1",
    concurrency: isNativeMode ? "" : config.concurrency?.toString() || "1",
  })) || [];

const getScenarioContents = (scenario: any) => {
  const testScenario = scenario.testScenario || {};
  const execution = testScenario.execution?.[0];
  const scenarios = testScenario.scenarios || {};
  const scenarioKey = Object.keys(scenarios)[0];
  const scenarioConfig = scenarios[scenarioKey] || {};
  const request = scenarioConfig.requests?.[0] || {};
  return { execution, scenarioConfig, request };
};

const getScenarioMetadata = (scenario: any, scenarioConfig: any, preserveId: boolean) => ({
  testName: preserveId ? scenario.testName || "" : `${scenario.testName || ""} (Copy)`,
  testDescription: scenario.testDescription || "",
  testId: preserveId ? scenario.testId : generateUniqueId(VALIDATION_LIMITS.TEST_ID_LENGTH),
  testType: scenario.testType,
  showLive: scenario.showLive,
  scriptFile: preserveId && scenarioConfig.script ? [new File([], scenarioConfig.script)] : [],
  fileError: "",
  tags: scenario.tags
    ? scenario.tags.map((tag: string) => ({ label: tag, dismissLabel: `Remove ${tag} keyword` }))
    : [],
  healthyThreshold:
    scenario.healthyThreshold !== undefined && scenario.healthyThreshold !== null
      ? String(scenario.healthyThreshold)
      : "90",
});

const getRequestFields = (request: any) => {
  const method = request.method || "GET";
  return {
    httpEndpoint: request.url || "",
    httpMethod: { label: method, value: method },
    requestHeaders: getRequestHeaders(request.headers),
    bodyPayload: getBodyPayload(request.body),
  };
};

export const transformScenarioToFormData = (scenario: any, preserveId = false) => {
  const { execution, scenarioConfig, request } = getScenarioContents(scenario);
  const nativeRunMode = scenario.nativeRunMode;
  const isNativeMode = !!nativeRunMode;

  return {
    ...getScenarioMetadata(scenario, scenarioConfig, preserveId),
    ...getRequestFields(request),
    ...getScheduleFields(scenario),
    regions: getRegions(scenario.testTaskConfigs, isNativeMode),
    testMode: isNativeMode ? TestMode.NATIVE : TestMode.STANDARD,
    ...getStandardModeFields(execution, isNativeMode),
    ...getNativeModeFields(nativeRunMode),
  };
};
