// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleStopRun } from "../../src/tools/stop-run.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

describe("handleStopRun", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // Verifies POST to /scenarios/{test_id} (no body) triggers cancellation
    it("should successfully stop a running test", async () => {
      const mockResult = { testId: "test-12345", status: "cancelled" };
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockResult),
        headers: {},
      };

      mockHttpClient.request.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = { test_id: "test-12345" };
      const result = await handleStopRun(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.request).toHaveBeenCalledWith({
        method: "POST",
        url: `${apiEndpoint}/scenarios/test-12345`,
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe("Parameter validation", () => {
    // StopRunSchema requires test_id
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = {};

      await expect(handleStopRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleStopRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

  });

  describe("Error handling", () => {
    // Non-200 from API is re-thrown with the API's status code
    it("should throw AppError when API returns non-200 status", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 404,
        body: "Test not found",
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = { test_id: "test-12345" };

      await expect(handleStopRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleStopRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    // Network-level failures caught and wrapped as 500 "Internal request failed"
    it("should throw AppError with 500 when HTTP client throws", async () => {
      mockHttpClient.request.mockRejectedValue(new Error("Network error"));

      const event: AgentCoreEvent = { test_id: "test-12345" };

      await expect(handleStopRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleStopRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleStopRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(500);
      }
    });
  });
});
