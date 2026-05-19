// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleListScenarios } from "../../src/tools/list-scenarios.js";
import {
  createMockHttpClient,
  expectGetCalledWith,
  mockErrorResponse,
  mockNetworkError,
  mockSuccessResponse,
  type MockHttpClient,
} from "../test-utils.js";

describe("handleListScenarios", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
  });

  it("should successfully list scenarios", async () => {
    const mockScenarios = {
      scenarios: [
        { testId: "test-123", testName: "Load Test 1" },
        { testId: "test-456", testName: "Load Test 2" },
      ],
    };

    const mockResponse: HttpResponse = {
      statusCode: 200,
      body: JSON.stringify(mockScenarios),
      headers: {},
    };

    mockHttpClient.get.mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};
    const result = await handleListScenarios(mockHttpClient, apiEndpoint, event);

    expectGetCalledWith(mockHttpClient, `${apiEndpoint}/scenarios`);
    expect(result).toEqual(mockScenarios);
  });

  it("should handle empty scenarios list", async () => {
    const mockResponse: HttpResponse = {
      statusCode: 200,
      body: JSON.stringify({ scenarios: [] }),
      headers: {},
    };

    mockHttpClient.get.mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};
    const result = await handleListScenarios(mockHttpClient, apiEndpoint, event);

    expect(result).toEqual({ scenarios: [] });
  });

  it("should throw AppError when API returns non-200 status", async () => {
    mockErrorResponse(mockHttpClient, 500, "Internal server error");

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow("Internal server error");
  });

  it("should throw AppError with 404 when no scenarios found", async () => {
    mockSuccessResponse(mockHttpClient, null);

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow("No scenarios found");

    try {
      await handleListScenarios(mockHttpClient, apiEndpoint, event);
    } catch (error) {
      expect((error as AppError).code).toBe(404);
    }
  });

  it("should throw AppError with 500 when HTTP client throws", async () => {
    mockNetworkError(mockHttpClient, "Network error");

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow("Internal request failed");

    try {
      await handleListScenarios(mockHttpClient, apiEndpoint, event);
    } catch (error) {
      expect((error as AppError).code).toBe(500);
    }
  });

  it("should accept empty event object", async () => {
    const mockResponse: HttpResponse = {
      statusCode: 200,
      body: JSON.stringify({ scenarios: [] }),
      headers: {},
    };

    mockHttpClient.get.mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
  });

  it("should handle malformed JSON response", async () => {
    const mockResponse: HttpResponse = {
      statusCode: 200,
      body: "invalid json",
      headers: {},
    };

    mockHttpClient.get.mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow();
  });
});
