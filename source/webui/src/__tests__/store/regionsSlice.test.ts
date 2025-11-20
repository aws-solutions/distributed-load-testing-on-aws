// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { server, MOCK_SERVER_URL } from "../server";
import { http, HttpResponse, delay } from "msw";
import { regionsSlice, regionsApiSlice, setRegionsData } from "../../store/regionsSlice";
import { solutionApi, ApiEndpoints } from "../../store/solutionApi";

const createTestStore = () =>
  configureStore({
    reducer: {
      regions: regionsSlice.reducer,
      [solutionApi.reducerPath]: solutionApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });

describe("regionsSlice", () => {
  describe("reducers", () => {
    it("should return initial state", () => {
      const state = regionsSlice.reducer(undefined, { type: "unknown" });
      expect(state).toEqual({ data: null });
    });

    it("should handle setRegionsData with valid data", () => {
      const initialState = { data: null };
      const regions = ["us-east-1", "us-west-2", "eu-west-1"];
      const action = setRegionsData(regions);
      const newState = regionsSlice.reducer(initialState, action);

      expect(newState.data).toEqual(regions);
    });

    it("should handle setRegionsData with empty array", () => {
      const initialState = { data: ["us-east-1"] };
      const action = setRegionsData([]);
      const newState = regionsSlice.reducer(initialState, action);

      expect(newState.data).toEqual([]);
    });

    it("should handle setRegionsData overwriting existing data", () => {
      const initialState = { data: ["us-east-1", "us-west-2"] };
      const newRegions = ["eu-west-1", "ap-southeast-1"];
      const action = setRegionsData(newRegions);
      const newState = regionsSlice.reducer(initialState, action);

      expect(newState.data).toEqual(newRegions);
    });
  });

  describe("API queries", () => {
    let store: ReturnType<typeof createTestStore>;

    beforeEach(() => {
      store = createTestStore();
    });

    it("should fetch regions successfully", async () => {
      const mockRegions = {
        regions: [{ region: "us-east-1" }, { region: "us-west-2" }, { region: "eu-west-1" }],
      };

      server.use(
        http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, async () => {
          await delay(100);
          return HttpResponse.json(mockRegions);
        })
      );

      const promise = store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());

      expect(store.getState().regions.data).toBeNull();

      const result = await promise;

      expect(result.data).toEqual(mockRegions);
      expect(store.getState().regions.data).toEqual(["us-east-1", "us-west-2", "eu-west-1"]);
    });

    it("should handle empty regions response", async () => {
      server.use(http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json({ regions: [] })));

      const promise = store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      await promise;

      expect(store.getState().regions.data).toEqual([]);
    });

    it("should handle malformed response", async () => {
      server.use(
        http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json({ invalidField: "data" }))
      );

      const promise = store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      await promise;

      expect(store.getState().regions.data).toEqual([]);
    });
  });

  describe("integration tests", () => {
    let store: ReturnType<typeof createTestStore>;

    beforeEach(() => {
      store = createTestStore();
    });

    it("should handle multiple concurrent requests", async () => {
      const mockRegions = {
        regions: [{ region: "us-east-1" }, { region: "us-west-2" }],
      };

      server.use(
        http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, async () => {
          await delay(50);
          return HttpResponse.json(mockRegions);
        })
      );

      const promises = [
        store.dispatch(regionsApiSlice.endpoints.getRegions.initiate()),
        store.dispatch(regionsApiSlice.endpoints.getRegions.initiate()),
      ];

      const results = await Promise.all(promises);

      results.forEach((result) => {
        expect(result.data).toEqual(mockRegions);
      });

      expect(store.getState().regions.data).toEqual(["us-east-1", "us-west-2"]);
    });

    it("should maintain state consistency across API calls", async () => {
      const firstResponse = {
        regions: [{ region: "us-east-1" }],
      };
      const secondResponse = {
        regions: [{ region: "eu-west-1" }, { region: "ap-southeast-1" }],
      };

      server.use(http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json(firstResponse)));

      await store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      expect(store.getState().regions.data).toEqual(["us-east-1"]);

      server.use(http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json(secondResponse)));

      await store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      expect(store.getState().regions.data).toEqual(["eu-west-1", "ap-southeast-1"]);
    });
  });
});
