// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { server, MOCK_SERVER_URL } from "../server";
import { http, HttpResponse, delay } from "msw";
import { regionsSlice, regionsApiSlice, setRegionNames } from "../../store/regionsSlice";
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
      expect(state).toEqual({ regionNames: null, regionalStacks: null });
    });

    it("should handle setRegionNames with valid data", () => {
      const initialState = { regionNames: null, regionalStacks: null };
      const regions = ["us-east-1", "us-west-2", "eu-west-1"];
      const action = setRegionNames(regions);
      const newState = regionsSlice.reducer(initialState, action);

      expect(newState.regionNames).toEqual(regions);
    });

    it("should handle setRegionNames with empty array", () => {
      const initialState = { regionNames: ["us-east-1"], regionalStacks: null };
      const action = setRegionNames([]);
      const newState = regionsSlice.reducer(initialState, action);

      expect(newState.regionNames).toEqual([]);
    });

    it("should handle setRegionNames overwriting existing data", () => {
      const initialState = { regionNames: ["us-east-1", "us-west-2"], regionalStacks: null };
      const newRegions = ["eu-west-1", "ap-southeast-1"];
      const action = setRegionNames(newRegions);
      const newState = regionsSlice.reducer(initialState, action);

      expect(newState.regionNames).toEqual(newRegions);
    });
  });

  describe("API queries", () => {
    let store: ReturnType<typeof createTestStore>;

    beforeEach(() => {
      store = createTestStore();
    });

    it("should fetch regions successfully", async () => {
      const mockRegions = {
        regions: [
          { region: "us-east-1", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" },
          { region: "us-west-2", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" },
          { region: "eu-west-1", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" },
        ],
      };

      server.use(
        http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, async () => {
          await delay(100);
          return HttpResponse.json(mockRegions);
        })
      );

      const promise = store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());

      expect(store.getState().regions.regionNames).toBeNull();
      expect(store.getState().regions.regionalStacks).toBeNull();

      const result = await promise;

      expect(result.data).toEqual(mockRegions);
      expect(store.getState().regions.regionNames).toEqual(["us-east-1", "us-west-2", "eu-west-1"]);
      expect(store.getState().regions.regionalStacks).toEqual(mockRegions.regions);
    });

    it("should handle empty regions response", async () => {
      server.use(http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json({ regions: [] })));

      const promise = store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      await promise;

      expect(store.getState().regions.regionNames).toEqual([]);
      expect(store.getState().regions.regionalStacks).toEqual([]);
    });

    it("should handle malformed response", async () => {
      server.use(
        http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json({ invalidField: "data" }))
      );

      const promise = store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      await promise;

      expect(store.getState().regions.regionNames).toEqual([]);
      expect(store.getState().regions.regionalStacks).toEqual([]);
    });
  });

  describe("integration tests", () => {
    let store: ReturnType<typeof createTestStore>;

    beforeEach(() => {
      store = createTestStore();
    });

    it("should handle multiple concurrent requests", async () => {
      const mockRegions = {
        regions: [
          { region: "us-east-1", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" },
          { region: "us-west-2", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" },
        ],
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

      expect(store.getState().regions.regionNames).toEqual(["us-east-1", "us-west-2"]);
      expect(store.getState().regions.regionalStacks).toEqual(mockRegions.regions);
    });

    it("should maintain state consistency across API calls", async () => {
      const firstResponse = {
        regions: [{ region: "us-east-1", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" }],
      };
      const secondResponse = {
        regions: [
          { region: "eu-west-1", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" },
          { region: "ap-southeast-1", version: "v4.0.0", compatible: true, deploymentDate: "2025-01-15T00:00:00.000Z" },
        ],
      };

      server.use(http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json(firstResponse)));

      await store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      expect(store.getState().regions.regionNames).toEqual(["us-east-1"]);
      expect(store.getState().regions.regionalStacks).toEqual(firstResponse.regions);

      server.use(http.get(`${MOCK_SERVER_URL}${ApiEndpoints.REGIONS}`, () => HttpResponse.json(secondResponse)));

      await store.dispatch(regionsApiSlice.endpoints.getRegions.initiate());
      expect(store.getState().regions.regionNames).toEqual(["eu-west-1", "ap-southeast-1"]);
      expect(store.getState().regions.regionalStacks).toEqual(secondResponse.regions);
    });
  });
});
