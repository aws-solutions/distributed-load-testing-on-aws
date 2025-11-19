// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createAsyncThunk } from "@reduxjs/toolkit";
import { get } from "aws-amplify/api";
import { ApiEndpoints } from "./solutionApi.ts";
import { addNotification } from "./notificationsSlice.ts";
import { v4 } from "uuid";

export const fetchUser = createAsyncThunk<any, void>("user/fetchUser", async (_, thunkAPI): Promise<any> => {
  try {
    const response = await get({
      apiName: "solution-api",
      path: ApiEndpoints.USER,
    }).response;

    return await response.body.json();
  } catch {
    thunkAPI.dispatch(
      addNotification({
        id: v4(),
        content: "Failed to load user data",
        type: "error",
      })
    );
    return Promise.reject(new Error("Failed to load user data"));
  }
});
