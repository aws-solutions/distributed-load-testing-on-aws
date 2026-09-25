// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// RTK Query endpoint for per-region vCPU details, used by the multi-region
// traffic config table. Previously injected inline in TrafficShapeStep.

import { solutionApi } from "../../../store/solutionApi";

const vCPUDetailsApi = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    getVCPUDetails: builder.query<any, void>({
      query: () => "/vCPUDetails",
    }),
  }),
});

export const { useGetVCPUDetailsQuery } = vCPUDetailsApi;

export interface VCPUDetail {
  vCPUsPerTask?: number;
  vCPULimit?: number;
  vCPUsInUse?: number;
}

// Display value for a region's available DLT tasks: a count (>= 0), "ERROR" when
// the numbers are present but yield NaN, or "-" when data hasn't loaded yet.
export const availableTasksDisplay = (detail?: VCPUDetail): number | string => {
  const perTask = detail?.vCPUsPerTask;
  const limit = detail?.vCPULimit;
  const inUse = detail?.vCPUsInUse;
  if (limit && perTask && inUse !== undefined) {
    const available = Math.floor((limit - inUse) / perTask);
    return Number.isNaN(available) ? "ERROR" : Math.max(0, available);
  }
  return "-";
};

// Display value for a region's total DLT task limit: the Fargate vCPU quota
// divided by the vCPUs each task consumes. "-" until the numbers have loaded.
export const taskLimitDisplay = (detail?: VCPUDetail): number | string => {
  const perTask = detail?.vCPUsPerTask;
  const limit = detail?.vCPULimit;
  if (limit && perTask) {
    const taskLimit = Math.floor(limit / perTask);
    return Number.isNaN(taskLimit) ? "ERROR" : taskLimit;
  }
  return "-";
};
