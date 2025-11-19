// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ApiEndpoints, solutionApi } from "./solutionApi.ts";

interface StackInfo {
  created_time: string;
  region: string;
  version: string;
  mcp_endpoint: string | undefined;
}

export const stackInfoApiSlice = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    getStackInfo: builder.query<StackInfo, void>({
      query: () => ApiEndpoints.STACK_INFO,
      providesTags: [{ type: "StackInfo" }],
    }),
  }),
});

export const { useGetStackInfoQuery } = stackInfoApiSlice;
