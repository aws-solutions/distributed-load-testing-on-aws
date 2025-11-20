// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { solutionApi, ApiEndpoints } from "./solutionApi.ts";

interface RegionsState {
  data: string[] | null;
}

const initialState: RegionsState = {
  data: null,
};

export const regionsSlice = createSlice({
  name: "regions",
  initialState,
  reducers: {
    setRegionsData: (state, action: PayloadAction<string[]>) => {
      state.data = action.payload;
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
          const regionValues = data.regions?.map((region: any) => region.region) || [];
          dispatch(regionsSlice.actions.setRegionsData(regionValues));
        } catch (error) {
          console.error("Failed to fetch regions:", error);
        }
      },
    }),
  }),
});

export const { setRegionsData } = regionsSlice.actions;
export const { useGetRegionsQuery } = regionsApiSlice;
