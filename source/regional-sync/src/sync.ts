// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { RegionalSyncResult, ServiceStabilizationResult } from "@amzn/dlt-common";
import { StabilizationStatus } from "@amzn/dlt-common";

/**
 * Validates that all regions have successfully stabilized their ECS services.
 *
 * Receives one {@link ServiceStabilizationResult} per region from the step
 * function Map state output, checks that every region has `status === "READY"`,
 * computes the synchronization delay between the fastest and slowest region,
 * and identifies any failed regions.
 *
 * @throws {Error} If the regions array is empty — indicates a step function
 *   misconfiguration since the Map state should always produce at least one item.
 */
export function validateRegions(regions: readonly ServiceStabilizationResult[]): RegionalSyncResult {
  if (regions.length === 0) {
    throw new Error("No regions provided — the step function Map state produced an empty result array");
  }

  const failedRegions = regions
    .filter((r) => r.status !== StabilizationStatus.READY)
    .map((r) => r.testTaskConfig.region);

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
    ...(failedRegions.length > 0 ? { failedRegions } : {}),
  };

  return result;
}
