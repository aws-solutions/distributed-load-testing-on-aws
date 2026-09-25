// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleUpdateTest } from "../../src/tools/update-test.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

vi.mock("../../src/lib/scenario-helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRegionalTaskDetails: vi.fn().mockResolvedValue({
    "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 0, dltTaskLimit: 25, dltAvailableTasks: 25 },
  }),
  buildScenarioPayload: vi.fn().mockReturnValue({ testName: "Updated", saveOnly: true }),
}));

import { buildScenarioPayload } from "../../src/lib/scenario-helpers.js";

describe("handleUpdateTest", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  const validEvent: AgentCoreEvent = {
    test_id: "abc1234567",
    test_name: "Updated Test",
    test_description: "Updated description",
    test_type: "simple",
    test_task_configs: [{ region: "us-east-1", task_count: 2, concurrency: 5 }],
    test_scenario: {
      execution: [{ "ramp-up": "10s", "hold-for": "2m", scenario: "Updated Test" }],
      scenarios: { "Updated Test": { requests: [{ url: "https://example.com", method: "GET" }] } },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = createMockHttpClient();
    // Default: the existence-check GET finds the test, so tests exercise the
    // POST path. Individual tests override this to cover not-found cases.
    mockHttpClient.get.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ testId: "abc1234567", testName: "Existing Test" }),
      headers: {},
    });
  });

  describe("Successful requests", () => {
    // update_test calls buildScenarioPayload with { saveOnly: true } then POSTs to /scenarios
    it("should POST updated payload to /scenarios", async () => {
      const mockResult = { testId: "abc1234567", testName: "Updated Test" };
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockResult),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const result = await handleUpdateTest(mockHttpClient, apiEndpoint, validEvent);

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: `${apiEndpoint}/scenarios`,
        })
      );
      expect(result).toEqual(mockResult);
    });

    // Verifies saveOnly option is passed (same as create_test)
    it("should call buildScenarioPayload with saveOnly option", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "abc1234567" }),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      await handleUpdateTest(mockHttpClient, apiEndpoint, validEvent);

      expect(buildScenarioPayload).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { saveOnly: true }
      );
    });
  });

  describe("Parameter validation", () => {
    // UpdateTestSchema requires test_id (unlike CreateTestSchema where it's optional)
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = { ...validEvent };
      delete event["test_id"];

      await expect(handleUpdateTest(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUpdateTest(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

  });

  describe("Existence check", () => {
    // update_test must not create: an unknown test_id has to fail, not upsert.
    it("should throw 404 and not POST when the test does not exist", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 404, body: "TEST_NOT_FOUND", headers: {} });

      await expect(handleUpdateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);

      try {
        await handleUpdateTest(mockHttpClient, apiEndpoint, validEvent);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
      expect(mockHttpClient.request).not.toHaveBeenCalled();
    });

    it("should throw 404 when the scenario lookup returns a null body", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: "null", headers: {} });

      await expect(handleUpdateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(
        `Test not found: ${validEvent["test_id"] as string}`
      );
      expect(mockHttpClient.request).not.toHaveBeenCalled();
    });

    it("should throw 500 when the existence-check request fails", async () => {
      mockHttpClient.get.mockRejectedValue(new Error("Network error"));

      await expect(handleUpdateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(
        "Internal request failed"
      );
      expect(mockHttpClient.request).not.toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should throw AppError when API returns non-200 status", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 409,
        body: "Test is currently running",
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      await expect(handleUpdateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);

      try {
        await handleUpdateTest(mockHttpClient, apiEndpoint, validEvent);
      } catch (error) {
        expect((error as AppError).code).toBe(409);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      mockHttpClient.request.mockRejectedValue(new Error("Network error"));

      await expect(handleUpdateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);
      await expect(handleUpdateTest(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(
        "Internal request failed"
      );
    });
  });
});
