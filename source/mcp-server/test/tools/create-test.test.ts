// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { CreateTestSchema, handleCreateTest } from "../../src/tools/create-test.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

// Mock fetchRegionalTaskDetails and buildScenarioPayload (called internally by create-test)
vi.mock("../../src/lib/scenario-helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRegionalTaskDetails: vi.fn().mockResolvedValue({
    "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 0, dltTaskLimit: 25, dltAvailableTasks: 25 },
  }),
  buildScenarioPayload: vi.fn().mockReturnValue({ testName: "Test", saveOnly: true }),
}));

import { buildScenarioPayload } from "../../src/lib/scenario-helpers.js";

describe("handleCreateTest", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  const validEvent: AgentCoreEvent = {
    test_name: "My Load Test",
    test_description: "Testing endpoint performance",
    test_type: "simple",
    test_task_configs: [{ region: "us-east-1", task_count: 1, concurrency: 10 }],
    test_scenario: {
      execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "My Load Test" }],
      scenarios: { "My Load Test": { requests: [{ url: "https://example.com", method: "GET" }] } },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // create_test calls buildScenarioPayload with { saveOnly: true } then POSTs to /scenarios
    it("should POST payload to /scenarios and return parsed response", async () => {
      const mockResult = { testId: "abc1234567", testName: "My Load Test", status: "created" };
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockResult),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const result = await handleCreateTest(mockHttpClient, apiEndpoint, validEvent);

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: `${apiEndpoint}/scenarios`,
        })
      );
      expect(result).toEqual(mockResult);
    });

    // buildScenarioPayload is called with saveOnly: true (not scheduleStep)
    it("should call buildScenarioPayload with saveOnly option", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "abc1234567" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      await handleCreateTest(mockHttpClient, apiEndpoint, validEvent);

      expect(buildScenarioPayload).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { saveOnly: true }
      );
    });

  });

  describe("Parameter validation", () => {
    // CreateTestSchema requires: test_name, test_description, test_type, test_task_configs, test_scenario
    it("should throw AppError for missing required fields", async () => {
      const event: AgentCoreEvent = { test_name: "Incomplete" };

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleCreateTest(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError when script-based test_type is used without test_id", async () => {
      const event: AgentCoreEvent = {
        ...validEvent,
        test_type: "jmeter",
      };

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleCreateTest(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("test_id is required for script-based tests");
      }
    });

    it("should allow simple test_type without test_id", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "abc1234567" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = { ...validEvent, test_type: "simple" };

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
    });

    it("should allow script-based test_type when test_id is provided", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "existIng1d" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        ...validEvent,
        test_type: "jmeter",
        test_id: "existIng1d",
      };

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
    });

    it("should accept a valid native_run_mode", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "existIng1d" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        ...validEvent,
        test_type: "locust",
        test_id: "existIng1d",
        native_run_mode: {
          maxTestDurationSeconds: 3600,
        },
      };

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
    });

    it("should throw AppError for an invalid native_run_mode", async () => {
      const event: AgentCoreEvent = {
        ...validEvent,
        native_run_mode: { maxTestDurationSeconds: 0 },
      };

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleCreateTest(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("maxTestDurationSeconds must be at least 1");
      }
    });

  });

  describe("Name validation and trimming (shared schema)", () => {
    // The shared name schema auto-trims surrounding whitespace before validating.
    it("should trim surrounding whitespace from test_name", () => {
      const parsed = CreateTestSchema.parse({ ...validEvent, test_name: "  Padded Name  " });
      expect(parsed.test_name).toBe("Padded Name");
    });

    // A name that is only valid before trimming (too short after) is rejected.
    it("should reject a name that is too short after trimming", () => {
      const result = CreateTestSchema.safeParse({ ...validEvent, test_name: "  ab  " });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes("test_name"))).toBe(true);
      }
    });
  });

  describe("Error handling", () => {
    // Non-200 from API is re-thrown with the API's status code
    it("should throw AppError when API returns non-200 status", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 400,
        body: "Bad request",
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);

      try {
        await handleCreateTest(mockHttpClient, apiEndpoint, validEvent);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    // Network-level failures caught and wrapped as 500 "Internal request failed"
    it("should throw AppError with 500 when HTTP client throws", async () => {
      mockHttpClient.request.mockRejectedValue(new Error("Network error"));

      await expect(handleCreateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);
      await expect(handleCreateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleCreateTest(mockHttpClient, apiEndpoint, validEvent);
      } catch (error) {
        expect((error as AppError).code).toBe(500);
      }
    });
  });
});
