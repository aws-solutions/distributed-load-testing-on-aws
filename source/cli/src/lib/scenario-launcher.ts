// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ApiClient } from "./api-client.js";
import type { Scenario, VCpuDetailsResponse, VCpuRegionDetails } from "./types.js";

interface RegionalTaskDetails {
  [region: string]: VCpuRegionDetails & { dltAvailableTasks: number };
}

/**
 * Validate Fargate capacity for every region in the scenario's task configs.
 * Returns the regionalTaskDetails object needed by the start payload.
 */
export async function fetchAndValidateCapacity(api: ApiClient, scenario: Scenario): Promise<RegionalTaskDetails> {
  const taskConfigs = scenario.testTaskConfigs;
  if (!taskConfigs || taskConfigs.length === 0) {
    throw new Error("Scenario has no testTaskConfigs configured.");
  }

  console.error("Checking Fargate capacity.");
  const vcpuDetails = await api.get<VCpuDetailsResponse>("/vCPUDetails");

  const regionalTaskDetails: RegionalTaskDetails = {};
  for (const taskConfig of taskConfigs) {
    const region = taskConfig.region;
    const regionVcpu = vcpuDetails[region];
    if (!regionVcpu) {
      throw new Error(
        `No Fargate vCPU details available for region ${region}. ` + "Ensure the regional infrastructure is deployed."
      );
    }

    const vCPULimit = regionVcpu.vCPULimit ?? 0;
    const vCPUsInUse = regionVcpu.vCPUsInUse ?? 0;
    const vCPUsPerTask = regionVcpu.vCPUsPerTask ?? 1;
    const availableTasks = Math.floor((vCPULimit - vCPUsInUse) / vCPUsPerTask);

    if (taskConfig.taskCount > availableTasks) {
      throw new Error(
        `Insufficient Fargate capacity in ${region}: need ${taskConfig.taskCount} tasks but only ${availableTasks} available ` +
          `(${vCPUsInUse}/${vCPULimit} vCPUs in use).`
      );
    }

    regionalTaskDetails[region] = {
      ...regionVcpu,
      dltAvailableTasks: availableTasks,
    };
  }

  return regionalTaskDetails;
}

/**
 * Build the POST body for starting a test scenario.
 */
export function buildStartPayload(
  scenario: Scenario,
  regionalTaskDetails: RegionalTaskDetails
): Record<string, unknown> {
  const testScenario =
    typeof scenario.testScenario === "string" ? JSON.parse(scenario.testScenario) : scenario.testScenario;

  const cleanTaskConfigs = (scenario.testTaskConfigs ?? []).map((tc) => ({
    region: tc.region,
    taskCount: tc.taskCount,
    concurrency: tc.concurrency,
  }));

  const body: Record<string, unknown> = {
    testId: scenario.testId,
    testName: scenario.testName,
    testDescription: scenario.testDescription,
    testType: scenario.testType,
    showLive: scenario.showLive ?? false,
    testTaskConfigs: cleanTaskConfigs,
    testScenario,
    fileType: scenario.fileType,
    regionalTaskDetails,
  };

  if (scenario.tags) {
    body["tags"] = scenario.tags;
  }

  return body;
}

/**
 * Orchestrates fetching, validating, and starting a test scenario.
 */
export async function startScenario(api: ApiClient, testId: string): Promise<unknown> {
  // 1. Fetch the existing scenario configuration
  console.error(`Fetching scenario ${testId}.`);
  const scenario = await api.get<Scenario>(`/scenarios/${encodeURIComponent(testId)}?history=false&latest=false`);

  if (scenario.status === "running") {
    throw new Error(`Test ${testId} is already running. Cancel it first before starting a new run.`);
  }

  // 2. Validate capacity
  const regionalTaskDetails = await fetchAndValidateCapacity(api, scenario);

  // 3. Build and send payload
  const body = buildStartPayload(scenario, regionalTaskDetails);
  console.error("Starting test.");
  const result = await api.post<Record<string, unknown>>("/scenarios", body);

  console.error(
    `Test started: ${(result["testId"] as string) ?? testId} (status: ${(result["status"] as string) ?? "running"})`
  );

  return result;
}
