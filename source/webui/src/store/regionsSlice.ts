// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { solutionApi, ApiEndpoints } from "./solutionApi.ts";

/**
 * Regional stack information (spoke deployment)
 */
export interface RegionalStackInfo {
  region: string;
  version: string;
  compatible: boolean;
  deploymentDate: string;
  /** Stack ARN for the regional CloudFormation stack. Optional because it was added in v4.1.0; stacks deployed before this version will not have it until updated. */
  stackId?: string;
}

interface RegionsState {
  regionNames: string[] | null;
  regionalStacks: RegionalStackInfo[] | null;
}

const initialState: RegionsState = {
  regionNames: null,
  regionalStacks: null,
};

export const regionsSlice = createSlice({
  name: "regions",
  initialState,
  reducers: {
    setRegionNames: (state, action: PayloadAction<string[]>) => {
      state.regionNames = action.payload;
    },
    setRegionalStacks: (state, action: PayloadAction<RegionalStackInfo[]>) => {
      state.regionalStacks = action.payload;
    },
  },
});

export const regionsApiSlice = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    getRegions: builder.query<any, void>({
      query: () => ApiEndpoints.REGIONS,
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          const regions = data.regions || [];
          const regionNames = regions.map((region: any) => region.region);
          dispatch(regionsSlice.actions.setRegionNames(regionNames));
          dispatch(regionsSlice.actions.setRegionalStacks(regions));
        } catch (error) {
          console.error("Failed to fetch regions:", error);
        }
      },
    }),
  }),
});

export const { setRegionNames, setRegionalStacks } = regionsSlice.actions;
export const { useGetRegionsQuery } = regionsApiSlice;
