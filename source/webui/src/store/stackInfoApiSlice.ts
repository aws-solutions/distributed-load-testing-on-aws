// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ApiEndpoints, solutionApi } from "./solutionApi.ts";

export interface StackInfo {
  created_time: string;
  region: string;
  version: string;
  mcp_endpoint: string | undefined;
  deployment_id: string | undefined;
  account_id: string | undefined;
  stack_status: string | undefined;
  deployment_method: "cloudformation" | "launch-wizard";
  stack_id: string;
  solution_template: "cloudfront" | "alb-ecs" | "headless";
  latest_version?: string;
  is_update_available?: boolean;
}

/**
 * Stack info changes infrequently. It's changed by 1/ CloudFormation deployments or 2/ a new solution version.
 * We cache the stack info for 1 hour before refreshing it.
 */
export const STACK_INFO_CACHE_SECONDS = 3600; // 1 hour

export const stackInfoApiSlice = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    getStackInfo: builder.query<StackInfo, void>({
      query: () => ApiEndpoints.STACK_INFO,
      providesTags: [{ type: "StackInfo" }],
      keepUnusedDataFor: STACK_INFO_CACHE_SECONDS,
    }),
  }),
});

export const { useGetStackInfoQuery } = stackInfoApiSlice;
