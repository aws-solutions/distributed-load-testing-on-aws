// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { RegionalSyncResult, ServiceStabilizationResult } from "@amzn/dlt-common";
import { StabilizationStatus } from "@amzn/dlt-common";

/** Fallback cause when a non-READY region carries no specific errorMessage. */
const DEFAULT_REGION_FAILURE_CAUSE = "did not stabilize in time";

/**
 * Composes a specific, human-readable failure reason naming each region that
 * did not reach READY and its cause. The per-region cause comes from the
 * Stabilization Checker's `errorMessage` (e.g. circuit breaker, service
 * deleted/scaled to zero); regions that simply never stabilized fall back to a
 * generic cause. This is what the step function surfaces to the UI in place of
 * a generic "at least one region did not stabilize" constant.
 */
function composeSetupFailureReason(failedRegions: readonly ServiceStabilizationResult[]): string {
  const details = failedRegions
    .map((r) => {
      // Normalize a missing errorMessage to "", then fall back on empty or
      // whitespace-only text so a blank cause never renders as "region ()".
      const trimmed = r.errorMessage?.trim() ?? "";
      const cause = trimmed.length > 0 ? trimmed : DEFAULT_REGION_FAILURE_CAUSE;
      return `${r.testTaskConfig.region} (${cause})`;
    })
    .join("; ");
  const noun = failedRegions.length === 1 ? "region" : "regions";
  return `Load test setup failed in ${failedRegions.length} ${noun}: ${details}.`;
}

/**
 * Validates that all regions have successfully stabilized their ECS services.
 *
 * Receives one {@link ServiceStabilizationResult} per region from the step
 * function Map state output, checks that every region has `status === "READY"`,
 * computes the synchronization delay between the fastest and slowest region,
 * and identifies any failed regions.
 *
 * When any region failed, also composes a human-readable `errorReason` naming
 * the affected region(s) and their causes; the step function propagates it into
 * the scenario's terminal errorReason.
 *
 * @throws {Error} If the regions array is empty — indicates a step function
 *   misconfiguration since the Map state should always produce at least one item.
 */
export function validateRegions(regions: readonly ServiceStabilizationResult[]): RegionalSyncResult {
  if (regions.length === 0) {
    throw new Error("No regions provided — the step function Map state produced an empty result array");
  }

  const failedResults = regions.filter((r) => r.status !== StabilizationStatus.READY);
  const failedRegions = failedResults.map((r) => r.testTaskConfig.region);

  const allReady = regions.every((r) => r.status === StabilizationStatus.READY);

  const readyRegions = regions.filter((r) => r.status === StabilizationStatus.READY);
  let syncDelay = 0;

  if (readyRegions.length > 1) {
    const timestamps = readyRegions.map((r) => r.readyTimestamp);
    const minTimestamp = Math.min(...timestamps);
    const maxTimestamp = Math.max(...timestamps);
    syncDelay = maxTimestamp - minTimestamp;
  }

  const result: RegionalSyncResult = {
    allReady,
    syncDelay,
    regions: [...regions],
    ...(failedResults.length > 0 ? { failedRegions, errorReason: composeSetupFailureReason(failedResults) } : {}),
  };

  return result;
}
