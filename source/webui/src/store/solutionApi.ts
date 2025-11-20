// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { BaseQueryApi, BaseQueryFn, createApi, FetchArgs, FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import { del, get, patch, post, put } from "aws-amplify/api";

export enum ApiEndpoints {
  USER = "/users/self",
  SCENARIOS = "/scenarios",
  REGIONS = "/regions",
  STACK_INFO = "/stack-info",
}

// Boilerplate code. Do not change.
export const dynamicBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args: string | FetchArgs,
  api: BaseQueryApi,
  extraOptions: Record<string, unknown>
) => {
  /**
   * Runs Amplify request.
   *
   * @returns {Promise<any>} Promise with response data
   */
  function runAmplifyAxiosRequest(): Promise<any> {
    if (typeof args === "string") {
      return get({
        apiName: "solution-api",
        path: args,
        options: extraOptions,
      }).response.then((response) => response.body.json());
    } else {
      const requestOptions = {
        apiName: "solution-api",
        path: args.url,
        options: {
          body: args.body,
          ...extraOptions,
        },
      };

      switch (args.method) {
        case "POST":
          return post(requestOptions).response.then((response) => response.body.json());
        case "PUT":
          return put(requestOptions).response.then((response) => response.body.json());
        case "DELETE":
          return del(requestOptions).response.then((response) => response.body.json());
        case "PATCH":
          return patch(requestOptions).response.then((response) => response.body.json());
        default:
          return get(requestOptions).response.then((response) => response.body.json());
      }
    }
  }

  try {
    const data = await runAmplifyAxiosRequest();
    return { data };
  } catch (error: any) {
    const errorMessage = error?.response?.body || error?.message || 'An unexpected error occurred';
    
    // Catch timeout errors coming back from API Gateway (when 30s timeout limit is exceeded)
    const isNetworkError = error?.name === 'NetworkError' || 
                           errorMessage.includes('network error') ||
                           errorMessage.includes('Network error');
    
    return {
      error: {
        status: isNetworkError ? 504 : 'CUSTOM_ERROR',
        error: errorMessage,
        data: { message: errorMessage }
      } as FetchBaseQueryError
    };
  }
};

/**
 * Create 1 api per base URL. Only create a second API if you use multiple API Gateways in the backend.
 */
export const solutionApi = createApi({
  reducerPath: "solution-api",
  baseQuery: dynamicBaseQuery,
  endpoints: () => ({
    // for a more modular app, instead of defining more endpoints here, create apiSlice files and inject endpoints there
  }),
  refetchOnMountOrArgChange: true,
  tagTypes: ["Scenarios", "User", "StackInfo", "TestRuns"],
});
