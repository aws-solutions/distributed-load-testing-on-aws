// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { VALIDATION_LIMITS } from "../pages/scenarios/constants";
import { generateUniqueId } from "./generateUniqueId";
import { parseTimeUnit } from "./scenarioUtils";

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

export const transformScenarioToFormData = (scenario: any, preserveId = false) => {
  const testScenario = scenario.testScenario || {};
  const execution = testScenario.execution?.[0] || {};
  const scenarios = testScenario.scenarios || {};
  const scenarioKey = Object.keys(scenarios)[0];
  const scenarioConfig = scenarios[scenarioKey] || {};
  const request = scenarioConfig.requests?.[0] || {};
  
  let executionTiming = "run-now";
  let scheduleTime = "";
  let scheduleDate = "";
  let cronMinutes = "";
  let cronHours = "";
  let cronDayOfMonth = "";
  let cronMonth = "";
  let cronDayOfWeek = "";
  let cronExpiryDate = "";
  
  if (scenario.cronValue && typeof scenario.cronValue === 'string') {
    executionTiming = "run-schedule";
    const cronParts = scenario.cronValue.split(" ");
    if (cronParts.length >= 5) {
      cronMinutes = cronParts[0];
      cronHours = cronParts[1];
      cronDayOfMonth = cronParts[2];
      cronMonth = cronParts[3];
      cronDayOfWeek = cronParts[4];
    }
    cronExpiryDate = scenario.cronExpiryDate || "";
  } else if (scenario.scheduleDate && scenario.scheduleTime) {
    executionTiming = "run-once";
    scheduleDate = scenario.scheduleDate;
    scheduleTime = scenario.scheduleTime;
  }
  
  return {
    testName: preserveId ? scenario.testName || "" : `${scenario.testName || ""} (Copy)`,
    testDescription: scenario.testDescription || "",
    testId: preserveId ? scenario.testId : generateUniqueId(VALIDATION_LIMITS.TEST_ID_LENGTH),
    testType: scenario.testType,
    executionTiming,
    showLive: scenario.showLive,
    scriptFile: preserveId && scenarioConfig.script ? [new File([], scenarioConfig.script)] : [],
    fileError: "",
    tags: scenario.tags ? scenario.tags.map((tag: string) => ({ label: tag, dismissLabel: `Remove ${tag} tag` })) : [],
    httpEndpoint: request.url || "",
    httpMethod: { label: request.method || "GET", value: request.method || "GET" },
    requestHeaders: request.headers && typeof request.headers === "object" && Object.keys(request.headers).length > 0 ? JSON.stringify(request.headers, null, 2) : "",
    bodyPayload: getBodyPayload(request.body),
    scheduleTime,
    scheduleDate,
    cronMinutes,
    cronHours,
    cronDayOfMonth,
    cronMonth,
    cronDayOfWeek,
    cronYear: "",
    cronExpiryDate,
    regions:
      scenario.testTaskConfigs?.map((config: any) => ({
        region: config.region,
        taskCount: config.taskCount?.toString() || "1",
        concurrency: config.concurrency?.toString() || "1",
      })) || [],
    rampUpValue: parseTimeUnit(execution["ramp-up"] || "1m").value,
    rampUpUnit: parseTimeUnit(execution["ramp-up"] || "1m").unit,
    holdForValue: parseTimeUnit(execution["hold-for"] || "5m").value,
    holdForUnit: parseTimeUnit(execution["hold-for"] || "5m").unit,
  };
};