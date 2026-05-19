// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleGetScenarioDetails } from "../../src/tools/get-scenario-details.js";
import {
  createMockHttpClient,
  expectGetCalledWith,
  expectGetCalledWithContaining,
  mockErrorResponse,
  mockNetworkError,
  mockSuccessResponse,
  type MockHttpClient,
} from "../test-utils.js";

describe("handleGetScenarioDetails", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    it("should successfully get scenario details", async () => {
      const mockScenario = {
        testId: "test-12345",
        testName: "Load Test",
        testDescription: "Test description",
        testType: "simple",
        fileType: "jmx",
      };

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockScenario),
        headers: {},
      };

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      const result = await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);

      expectGetCalledWith(mockHttpClient, `${apiEndpoint}/scenarios/test-12345?history=false&latest=false`);
      expect(result).toEqual(mockScenario);
    });

    it("should handle scenario with alphanumeric and dash characters", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "abc-123-xy", testName: "Test" }),
        headers: {},
      };

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "abc-123-xy",
      };

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
    });

    it("should include query parameters for history and latest", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "test-12345" }),
        headers: {},
      };

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);

      expectGetCalledWithContaining(mockHttpClient, "history=false");
      expectGetCalledWithContaining(mockHttpClient, "latest=false");
    });
  });

  describe("Parameter validation", () => {
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = {};

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for invalid test_id length", async () => {
      const event: AgentCoreEvent = {
        test_id: "short",
      };

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("10 character");
      }
    });

    it("should throw AppError for test_id with invalid characters", async () => {
      const event: AgentCoreEvent = {
        test_id: "test_12345",
      };

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Invalid test_id");
      }
    });
  });

  describe("Error handling", () => {
    it("should throw AppError when API returns non-200 status", async () => {
      mockErrorResponse(mockHttpClient, 404, "Scenario not found");

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow("Scenario not found");

      try {
        await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 404 when scenario data is null", async () => {
      mockSuccessResponse(mockHttpClient, null);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Scenario not found: test-12345"
      );

      try {
        await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      mockNetworkError(mockHttpClient, "Network error");

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleGetScenarioDetails(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(500);
      }
    });

    it("should handle malformed JSON response", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: "invalid json",
        headers: {},
      };

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetScenarioDetails(mockHttpClient, apiEndpoint, event)).rejects.toThrow();
    });
  });
});
