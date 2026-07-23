// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { http, HttpResponse } from "msw";
import { server, MOCK_SERVER_URL } from "../server";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";
import { scenariosApiSlice } from "../../store/scenariosApiSlice";

function createTestStore() {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });
}

// The base URL is http://localhost:3001/ and RTK query builds paths like /scenarios
// so the actual URL becomes http://localhost:3001//scenarios (double slash).
// Use the same pattern as the default handlers.
const API = MOCK_SERVER_URL;

describe("scenariosApiSlice", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  describe("getScenarios", () => {
    it("fetches list of scenarios", async () => {
      server.use(
        http.get(`${API}/scenarios`, () => {
          return HttpResponse.json({
            Items: [
              { testId: "t1", testName: "Test 1", status: "complete" },
              { testId: "t2", testName: "Test 2", status: "running" },
            ],
          });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(scenariosApiSlice.endpoints.getScenarios.initiate());

      expect(result.data).toBeDefined();
      expect(result.data!.Items).toHaveLength(2);
      expect(result.data!.Items[0].testId).toBe("t1");
    });
  });

  describe("getScenarioDetails", () => {
    it("fetches scenario details with history=false", async () => {
      server.use(
        http.get(`${API}/scenarios/test-123`, ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("history")).toBe("false");
          return HttpResponse.json({
            testId: "test-123",
            testName: "My Test",
            testType: "simple",
          });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.getScenarioDetails.initiate({ testId: "test-123" })
      );

      expect(result.data).toBeDefined();
      expect(result.data!.testId).toBe("test-123");
    });

    it("fetches scenario details with history=true", async () => {
      server.use(
        http.get(`${API}/scenarios/test-123`, ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("history")).toBe("true");
          return HttpResponse.json({
            testId: "test-123",
            testName: "My Test",
          });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.getScenarioDetails.initiate({ testId: "test-123", includeHistory: true })
      );

      expect(result.data).toBeDefined();
    });
  });

  describe("getTestRuns", () => {
    it("fetches test runs with default limit", async () => {
      server.use(
        http.get(`${API}/scenarios/test-123/testruns`, ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("limit")).toBe("20");
          return HttpResponse.json({
            testRuns: [{ testRunId: "run-001", startTime: "2025-01-15 10:00:00", status: "complete" }],
            pagination: {},
          });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.getTestRuns.initiate({ testId: "test-123" })
      );

      expect(result.data).toBeDefined();
      expect(result.data!.testRuns).toHaveLength(1);
    });

    it("passes nextToken and date filters as query params", async () => {
      server.use(
        http.get(`${API}/scenarios/test-123/testruns`, ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("next_token")).toBe("token-abc");
          expect(url.searchParams.get("start_timestamp")).toBe("2025-01-01T00:00:00Z");
          expect(url.searchParams.get("end_timestamp")).toBe("2025-01-31T23:59:59Z");
          return HttpResponse.json({ testRuns: [], pagination: {} });
        })
      );

      const store = createTestStore();
      await store.dispatch(
        scenariosApiSlice.endpoints.getTestRuns.initiate({
          testId: "test-123",
          nextToken: "token-abc",
          startTimestamp: "2025-01-01T00:00:00Z",
          endTimestamp: "2025-01-31T23:59:59Z",
        })
      );
    });
  });

  describe("getTestRunDetails", () => {
    it("fetches details for a specific test run", async () => {
      server.use(
        http.get(`${API}/scenarios/test-123/testruns/run-001`, () => {
          return HttpResponse.json({
            testRunId: "run-001",
            testId: "test-123",
            startTime: "2025-01-15 10:00:00",
            status: "complete",
            results: { total: { succ: 1000, fail: 10 } },
          });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.getTestRunDetails.initiate({ testId: "test-123", testRunId: "run-001" })
      );

      expect(result.data).toBeDefined();
      expect(result.data!.testRunId).toBe("run-001");
    });
  });

  describe("getBaseline", () => {
    it("fetches baseline for a test", async () => {
      server.use(
        http.get(`${API}/scenarios/test-123/baseline`, () => {
          return HttpResponse.json({
            baselineId: "run-baseline",
            testRunDetails: {
              testRunId: "run-baseline",
              startTime: "2025-01-10 10:00:00",
              status: "complete",
            },
          });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.getBaseline.initiate({ testId: "test-123" })
      );

      expect(result.data).toBeDefined();
      expect(result.data!.baselineId).toBe("run-baseline");
    });

    it("returns null baselineId when no baseline is set", async () => {
      server.use(
        http.get(`${API}/scenarios/test-123/baseline`, () => {
          return HttpResponse.json({ baselineId: null });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.getBaseline.initiate({ testId: "test-123" })
      );

      expect(result.data!.baselineId).toBeNull();
    });
  });

  describe("deleteScenario", () => {
    it("sends DELETE request to the correct endpoint", async () => {
      server.use(
        http.delete(`${API}/scenarios/test-123`, () => {
          return HttpResponse.json({ message: "Scenario deleted" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.deleteScenario.initiate("test-123")
      );

      expect(result.data).toEqual({ message: "Scenario deleted" });
    });
  });

  describe("setTestRunBaseline", () => {
    it("sends PUT request with testRunId body", async () => {
      server.use(
        http.put(`${API}/scenarios/test-123/baseline`, async ({ request }) => {
          const body = await request.json() as any;
          expect(body.testRunId).toBe("run-001");
          return HttpResponse.json({ message: "Baseline set" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.setTestRunBaseline.initiate({ testId: "test-123", testRunId: "run-001" })
      );

      expect(result.data).toEqual({ message: "Baseline set" });
    });
  });

  describe("removeTestRunBaseline", () => {
    it("sends DELETE request to baseline endpoint", async () => {
      server.use(
        http.delete(`${API}/scenarios/test-123/baseline`, () => {
          return HttpResponse.json({ message: "Baseline removed" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.removeTestRunBaseline.initiate({ testId: "test-123" })
      );

      expect(result.data).toEqual({ message: "Baseline removed" });
    });
  });

  describe("stopScenario", () => {
    it("sends POST request with stop action", async () => {
      server.use(
        http.post(`${API}/scenarios/test-123`, async ({ request }) => {
          const body = await request.json() as any;
          expect(body.action).toBe("stop");
          return HttpResponse.json({ message: "Scenario stopped" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.stopScenario.initiate({ testId: "test-123" })
      );

      expect(result.data).toEqual({ message: "Scenario stopped" });
    });
  });

  describe("deleteTestRuns", () => {
    it("sends DELETE request with testRunIds array", async () => {
      server.use(
        http.delete(`${API}/scenarios/test-123/testruns`, async ({ request }) => {
          const body = await request.json() as any;
          expect(body).toEqual(["run-001", "run-002"]);
          return HttpResponse.json({ message: "Test runs deleted" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.deleteTestRuns.initiate({ testId: "test-123", testRunIds: ["run-001", "run-002"] })
      );

      expect(result.data).toEqual({ message: "Test runs deleted" });
    });
  });

  describe("createScenario", () => {
    it("sends POST request with scenario payload", async () => {
      server.use(
        http.post(`${API}/scenarios`, async ({ request }) => {
          const body = await request.json() as any;
          expect(body.testName).toBe("New Test");
          return HttpResponse.json({ testId: "new-test-id", testName: "New Test" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.createScenario.initiate({
          testName: "New Test",
          testDescription: "A new test scenario",
          testType: "simple",
          testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
          testScenario: { execution: [{ "hold-for": "1m" }] },
          regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } },
        } as any)
      );

      expect(result.data).toBeDefined();
      expect(result.data!.testId).toBe("new-test-id");
    });
  });

  describe("error handling", () => {
    it("returns error when API responds with error status", async () => {
      server.use(
        http.get(`${API}/scenarios`, () => {
          return HttpResponse.json(
            { message: "Internal Server Error" },
            { status: 500 }
          );
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(scenariosApiSlice.endpoints.getScenarios.initiate());

      expect(result.error).toBeDefined();
    });
  });

  describe("runScenario", () => {
    const mockScenario = {
      testId: "test-run-123",
      testName: "Run Test",
      testDescription: "Test description",
      testTaskConfigs: [
        { region: "us-east-1", taskCount: 2, concurrency: 10 },
        { region: "us-west-2", taskCount: 1, concurrency: 5 },
      ],
      testScenario: { execution: [{ "hold-for": "5m", "ramp-up": "1m" }] },
      testType: "simple",
      fileType: "none",
      showLive: true,
      tags: ["tag1"],
    } as any;

    it("fetches vCPU details and tasks, then posts the scenario", async () => {
      server.use(
        http.get(`${API}/vCPUDetails`, () => {
          return HttpResponse.json({
            "us-east-1": { vCPULimit: 100, vCPUsPerTask: 2, vCPUsInUse: 10 },
            "us-west-2": { vCPULimit: 50, vCPUsPerTask: 2, vCPUsInUse: 0 },
          });
        }),
        http.get(`${API}/tasks`, () => {
          return HttpResponse.json([
            { region: "us-east-1", taskArns: ["arn1", "arn2"] },
            { region: "us-west-2", taskArns: [] },
          ]);
        }),
        http.post(`${API}/scenarios`, async ({ request }) => {
          const body = await request.json() as any;
          expect(body.testId).toBe("test-run-123");
          expect(body.testName).toBe("Run Test");
          expect(body.testTaskConfigs[0].taskCount).toBe("2");
          expect(body.testTaskConfigs[0].concurrency).toBe("10");
          expect(body.regionalTaskDetails["us-east-1"].dltTaskLimit).toBe(50);
          expect(body.regionalTaskDetails["us-east-1"].dltAvailableTasks).toBe(48); // 50 - 2 running
          expect(body.regionalTaskDetails["us-west-2"].dltAvailableTasks).toBe(25); // 25 - 0 running
          return HttpResponse.json({ message: "Scenario started" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.runScenario.initiate(mockScenario)
      );

      expect(result.data).toEqual({ message: "Scenario started" });
    });

    it("handles vCPU/tasks fetch failure gracefully and still posts", async () => {
      server.use(
        http.get(`${API}/vCPUDetails`, () => {
          return HttpResponse.json(null, { status: 500 });
        }),
        http.get(`${API}/tasks`, () => {
          return HttpResponse.json(null, { status: 500 });
        }),
        http.post(`${API}/scenarios`, () => {
          return HttpResponse.json({ message: "Scenario started without details" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.runScenario.initiate(mockScenario)
      );

      expect(result.data).toEqual({ message: "Scenario started without details" });
    });

    it("handles post failure and returns error with status code", async () => {
      server.use(
        http.get(`${API}/vCPUDetails`, () => {
          return HttpResponse.json({});
        }),
        http.get(`${API}/tasks`, () => {
          return HttpResponse.json([]);
        }),
        http.post(`${API}/scenarios`, () => {
          return HttpResponse.json(
            { message: "Validation failed" },
            { status: 400 }
          );
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.runScenario.initiate(mockScenario)
      );

      expect(result.error).toBeDefined();
    });

    it("handles non-array tasks response", async () => {
      server.use(
        http.get(`${API}/vCPUDetails`, () => {
          return HttpResponse.json({
            "us-east-1": { vCPULimit: 100, vCPUsPerTask: 2, vCPUsInUse: 0 },
          });
        }),
        http.get(`${API}/tasks`, () => {
          // non-array response
          return HttpResponse.json({ error: "unexpected format" });
        }),
        http.post(`${API}/scenarios`, () => {
          return HttpResponse.json({ message: "Started" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.runScenario.initiate(mockScenario)
      );

      expect(result.data).toEqual({ message: "Started" });
    });

    it("uses default values when fileType and showLive are missing", async () => {
      const minimalScenario = {
        testId: "test-min",
        testName: "Minimal",
        testDescription: "Desc",
        testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
        testScenario: { execution: [{ "hold-for": "1m" }] },
        testType: "simple",
      } as any;

      server.use(
        http.get(`${API}/vCPUDetails`, () => HttpResponse.json({})),
        http.get(`${API}/tasks`, () => HttpResponse.json([])),
        http.post(`${API}/scenarios`, async ({ request }) => {
          const body = await request.json() as any;
          expect(body.fileType).toBe("");
          expect(body.showLive).toBe(false);
          expect(body.tags).toEqual([]);
          return HttpResponse.json({ message: "OK" });
        })
      );

      const store = createTestStore();
      const result = await store.dispatch(
        scenariosApiSlice.endpoints.runScenario.initiate(minimalScenario)
      );

      expect(result.data).toEqual({ message: "OK" });
    });
  });
});
