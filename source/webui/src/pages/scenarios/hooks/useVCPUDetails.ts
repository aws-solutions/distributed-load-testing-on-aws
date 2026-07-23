// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// RTK Query endpoint for per-region vCPU details, used by the region config and
// regional-availability sections. Previously injected inline in TrafficShapeStep.

import { solutionApi } from "../../../store/solutionApi";

const vCPUDetailsApi = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    getVCPUDetails: builder.query<any, void>({
      query: () => "/vCPUDetails",
    }),
  }),
});

export const { useGetVCPUDetailsQuery } = vCPUDetailsApi;
