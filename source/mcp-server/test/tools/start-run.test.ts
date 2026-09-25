// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleStartRun } from "../../src/tools/start-run.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

// Mock fetchRegionalTaskDetails since start-run calls it internally
vi.mock("../../src/lib/scenario-helpers.js", () => ({
  fetchRegionalTaskDetails: vi.fn().mockResolvedValue({
    "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 0, dltTaskLimit: 25, dltAvailableTasks: 25 },
  }),
}));

describe("handleStartRun", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  const storedScenario = {
    testId: "test-12345",
    testName: "My Test",
    testDescription: "A test",
    testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
    testScenario: JSON.stringify({ execution: [], scenarios: {} }),
    testType: "simple",
    fileType: "none",
    showLive: false,
    tags: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // start_run first GETs the stored scenario, then POSTs assembled payload to /scenarios
    it("should fetch scenario then POST to start execution", async () => {
      const scenarioResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(storedScenario),
        headers: {},
      };
      mockHttpClient.get.mockResolvedValue(scenarioResponse);

      const postResult = { testId: "test-12345", status: "queued" };
      const postResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(postResult),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(postResponse);

      const event: AgentCoreEvent = { test_id: "test-12345" };
      const result = await handleStartRun(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(`${apiEndpoint}/scenarios/test-12345`);
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: `${apiEndpoint}/scenarios`,
        })
      );
      expect(result).toEqual(postResult);
    });

    // Payload should include regionalTaskDetails from the mocked helper
    it("should include regionalTaskDetails in POST payload", async () => {
      const scenarioResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(storedScenario),
        headers: {},
      };
      mockHttpClient.get.mockResolvedValue(scenarioResponse);

      const postResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "test-12345", status: "queued" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(postResponse);

      const event: AgentCoreEvent = { test_id: "test-12345" };
      await handleStartRun(mockHttpClient, apiEndpoint, event);

      const requestBody = JSON.parse(
        (mockHttpClient.request.mock.calls[0][0] as { body: string }).body
      ) as Record<string, unknown>;
      expect(requestBody).toHaveProperty("regionalTaskDetails");
    });

    // A native-mode scenario forwards its stored nativeRunMode so the run
    // uses the native runner instead of reverting to Standard mode
    it("should forward stored nativeRunMode when present", async () => {
      const nativeRunMode = {
        maxTestDurationSeconds: 3600,
      };
      const scenarioResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ ...storedScenario, nativeRunMode }),
        headers: {},
      };
      mockHttpClient.get.mockResolvedValue(scenarioResponse);

      const postResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "test-12345", status: "queued" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(postResponse);

      const event: AgentCoreEvent = { test_id: "test-12345" };
      await handleStartRun(mockHttpClient, apiEndpoint, event);

      const requestBody = JSON.parse(
        (mockHttpClient.request.mock.calls[0][0] as { body: string }).body
      ) as Record<string, unknown>;
      expect(requestBody["nativeRunMode"]).toEqual(nativeRunMode);
    });

    // A legacy (Taurus) scenario has no nativeRunMode and must not add one
    it("should omit nativeRunMode when the stored scenario has none", async () => {
      const scenarioResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(storedScenario),
        headers: {},
      };
      mockHttpClient.get.mockResolvedValue(scenarioResponse);

      const postResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "test-12345", status: "queued" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(postResponse);

      const event: AgentCoreEvent = { test_id: "test-12345" };
      await handleStartRun(mockHttpClient, apiEndpoint, event);

      const requestBody = JSON.parse(
        (mockHttpClient.request.mock.calls[0][0] as { body: string }).body
      ) as Record<string, unknown>;
      expect(requestBody).not.toHaveProperty("nativeRunMode");
    });
  });

  describe("Parameter validation", () => {
    // StartRunSchema requires test_id with length 10 and regex /^[A-Za-z0-9-]+$/
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = {};

      await expect(handleStartRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleStartRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

  });

  describe("Error handling", () => {
    // If the GET /scenarios/{test_id} call fails, error is wrapped as 500
    it("should throw AppError when scenario fetch fails", async () => {
      mockHttpClient.get.mockRejectedValue(new Error("Network error"));

      const event: AgentCoreEvent = { test_id: "test-12345" };

      await expect(handleStartRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleStartRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Failed to fetch test configuration"
      );

      try {
        await handleStartRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(500);
      }
    });

    // Non-200 from scenario GET is re-thrown with that status code
    it("should throw AppError when scenario fetch returns non-200", async () => {
      const scenarioResponse: HttpResponse = {
        statusCode: 404,
        body: "Not found",
        headers: {},
      };
      mockHttpClient.get.mockResolvedValue(scenarioResponse);

      const event: AgentCoreEvent = { test_id: "test-12345" };

      await expect(handleStartRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleStartRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    // If the POST /scenarios call throws, error is wrapped as 500 "Internal request failed"
    it("should throw AppError when POST request throws", async () => {
      const scenarioResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(storedScenario),
        headers: {},
      };
      mockHttpClient.get.mockResolvedValue(scenarioResponse);
      mockHttpClient.request.mockRejectedValue(new Error("Network error"));

      const event: AgentCoreEvent = { test_id: "test-12345" };

      await expect(handleStartRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleStartRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleStartRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(500);
      }
    });
  });
});
