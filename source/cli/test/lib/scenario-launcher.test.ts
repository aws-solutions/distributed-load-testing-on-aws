// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStartPayload, fetchAndValidateCapacity, startScenario } from "../../src/lib/scenario-launcher.js";
import type { Scenario, VCpuRegionDetails } from "../../src/lib/types.js";

describe("scenario-launcher", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("fetchAndValidateCapacity", () => {
    it("returns regional task details when capacity is sufficient", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          "us-east-1": { vCPULimit: 100, vCPUsInUse: 10, vCPUsPerTask: 2 },
        }),
        post: vi.fn(),
      };
      const scenario: Scenario = {
        testId: "t1",
        testName: "Test",
        testTaskConfigs: [{ region: "us-east-1", taskCount: 5, concurrency: 10 }],
      };

      const result = await fetchAndValidateCapacity(mockApi as any, scenario);
      expect(result["us-east-1"]).toBeDefined();
      expect(result["us-east-1"]!.dltAvailableTasks).toBe(45);
    });

    it("throws when no testTaskConfigs", async () => {
      const mockApi = { get: vi.fn(), post: vi.fn() };
      const scenario: Scenario = { testId: "t1", testName: "Test" };

      await expect(fetchAndValidateCapacity(mockApi as any, scenario)).rejects.toThrow("no testTaskConfigs");
    });

    it("throws when region not available", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({}),
        post: vi.fn(),
      };
      const scenario: Scenario = {
        testId: "t1",
        testName: "Test",
        testTaskConfigs: [{ region: "eu-west-1", taskCount: 5, concurrency: 10 }],
      };

      await expect(fetchAndValidateCapacity(mockApi as any, scenario)).rejects.toThrow(
        "No Fargate vCPU details available for region eu-west-1"
      );
    });

    it("throws when insufficient capacity", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValue({
          "us-east-1": { vCPULimit: 10, vCPUsInUse: 8, vCPUsPerTask: 2 },
        }),
        post: vi.fn(),
      };
      const scenario: Scenario = {
        testId: "t1",
        testName: "Test",
        testTaskConfigs: [{ region: "us-east-1", taskCount: 5, concurrency: 10 }],
      };

      await expect(fetchAndValidateCapacity(mockApi as any, scenario)).rejects.toThrow("Insufficient Fargate capacity");
    });
  });

  describe("startScenario", () => {
    it("fetches, validates, and starts a scenario", async () => {
      const mockApi = {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            testId: "t1",
            testName: "Test",
            testType: "simple",
            fileType: "script",
            status: "completed",
            testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 5 }],
            testScenario: { execution: [] },
          })
          .mockResolvedValueOnce({
            "us-east-1": { vCPULimit: 100, vCPUsInUse: 0, vCPUsPerTask: 1 },
          }),
        post: vi.fn().mockResolvedValue({ testId: "t1", status: "running" }),
      };

      const result = await startScenario(mockApi as any, "t1");
      expect((result as any).status).toBe("running");
      expect(mockApi.post).toHaveBeenCalled();
    });

    it("throws when scenario is already running", async () => {
      const mockApi = {
        get: vi.fn().mockResolvedValueOnce({
          testId: "t1",
          testName: "Test",
          status: "running",
          testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 5 }],
        }),
        post: vi.fn(),
      };

      await expect(startScenario(mockApi as any, "t1")).rejects.toThrow("already running");
    });
  });

  describe("buildStartPayload", () => {
    const baseScenario: Scenario = {
      testId: "test-123",
      testName: "My Load Test",
      testDescription: "desc",
      testType: "simple",
      fileType: "script",
      status: "complete",
      showLive: true,
      testTaskConfigs: [
        { region: "us-east-1", taskCount: 5, concurrency: 10 },
        { region: "us-west-2", taskCount: 3, concurrency: 8 },
      ],
      testScenario: JSON.stringify({ execution: [{ rampup: "1m" }] }),
    };

    const regionalTaskDetails: Record<string, VCpuRegionDetails & { dltAvailableTasks: number }> = {
      "us-east-1": {
        vCPULimit: 100,
        vCPUsInUse: 10,
        vCPUsPerTask: 2,
        dltAvailableTasks: 45,
      },
      "us-west-2": {
        vCPULimit: 50,
        vCPUsInUse: 0,
        vCPUsPerTask: 1,
        dltAvailableTasks: 50,
      },
    };

    it("includes required fields", () => {
      const payload = buildStartPayload(baseScenario, regionalTaskDetails);

      expect(payload["testId"]).toBe("test-123");
      expect(payload["testName"]).toBe("My Load Test");
      expect(payload["testType"]).toBe("simple");
      expect(payload["fileType"]).toBe("script");
      expect(payload["showLive"]).toBe(true);
      expect(payload["regionalTaskDetails"]).toEqual(regionalTaskDetails);
    });

    it("parses testScenario from JSON string", () => {
      const payload = buildStartPayload(baseScenario, regionalTaskDetails);
      expect(payload["testScenario"]).toEqual({
        execution: [{ rampup: "1m" }],
      });
    });

    it("passes through testScenario when already an object", () => {
      const scenario = {
        ...baseScenario,
        testScenario: { execution: [{ rampup: "2m" }] },
      };
      const payload = buildStartPayload(scenario, regionalTaskDetails);
      expect(payload["testScenario"]).toEqual({
        execution: [{ rampup: "2m" }],
      });
    });

    it("strips extra fields from testTaskConfigs", () => {
      const scenario: Scenario = {
        ...baseScenario,
        testTaskConfigs: [
          {
            region: "us-east-1",
            taskCount: 5,
            concurrency: 10,
            extraField: "should be stripped",
          },
        ],
      };
      const payload = buildStartPayload(scenario, regionalTaskDetails);
      const configs = payload["testTaskConfigs"] as Record<string, unknown>[];
      expect(configs[0]).toEqual({
        region: "us-east-1",
        taskCount: 5,
        concurrency: 10,
      });
      expect(configs[0]).not.toHaveProperty("extraField");
    });

    it("includes tags when present", () => {
      const scenario: Scenario = {
        ...baseScenario,
        tags: ["perf", "regression"],
      };
      const payload = buildStartPayload(scenario, regionalTaskDetails);
      expect(payload["tags"]).toEqual(["perf", "regression"]);
    });

    it("omits tags when not present", () => {
      const payload = buildStartPayload(baseScenario, regionalTaskDetails);
      expect(payload).not.toHaveProperty("tags");
    });

    it("defaults showLive to false when undefined", () => {
      const scenario: Scenario = {
        ...baseScenario,
        showLive: undefined,
      };
      const payload = buildStartPayload(scenario, regionalTaskDetails);
      expect(payload["showLive"]).toBe(false);
    });
  });
});
