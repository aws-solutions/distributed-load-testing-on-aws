// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { isActiveRunStatus } from "@amzn/dlt-common";
import { ApiClient } from "./api-client.js";
import { buildScenarioBody, type CreateScenarioPayload } from "./scenario-payload.js";
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
 *
 * Routes through the shared `buildScenarioBody` so `start` carries exactly the
 * same field set as `create`/`update` — including `nativeRunMode`, which must
 * survive the re-POST or the re-run reverts to Standard mode and the
 * stored native config is wiped.
 */
export function buildStartPayload(
  scenario: Scenario,
  regionalTaskDetails: RegionalTaskDetails
): CreateScenarioPayload {
  const testScenario =
    typeof scenario.testScenario === "string" ? JSON.parse(scenario.testScenario) : (scenario.testScenario ?? {});

  return buildScenarioBody({
    testId: scenario.testId,
    testName: scenario.testName,
    testDescription: scenario.testDescription,
    testType: scenario.testType ?? "",
    fileType: scenario.fileType,
    showLive: scenario.showLive ?? false,
    testTaskConfigs: (scenario.testTaskConfigs ?? []).map((tc) => ({
      region: tc.region,
      taskCount: tc.taskCount,
      concurrency: tc.concurrency,
    })),
    testScenario: testScenario as Record<string, unknown>,
    regionalTaskDetails,
    tags: scenario.tags,
    nativeRunMode: scenario.nativeRunMode,
  });
}

/**
 * Orchestrates fetching, validating, and starting a test scenario.
 */
export async function startScenario(api: ApiClient, testId: string): Promise<unknown> {
  // 1. Fetch the existing scenario configuration
  console.error(`Fetching scenario ${testId}.`);
  const scenario = await api.get<Scenario>(`/scenarios/${encodeURIComponent(testId)}?history=false&latest=false`);

  // Client-side fast-fail using the shared active-run definition. The server
  // enforces this authoritatively (409 TEST_RUNNING); this just avoids a
  // pointless round trip and gives an immediate message for any active state.
  if (scenario.status && isActiveRunStatus(scenario.status)) {
    throw new Error(
      `Test ${testId} already has an active run (status: ${scenario.status}). Cancel it before starting a new run.`
    );
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
