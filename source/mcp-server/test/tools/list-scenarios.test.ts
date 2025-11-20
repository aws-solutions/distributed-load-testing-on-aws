// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse, IAMHttpClient } from "../../src/lib/http-client.js";
import { handleListScenarios } from "../../src/tools/list-scenarios.js";

describe("handleListScenarios", () => {
  let mockHttpClient: IAMHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = {
      get: vi.fn(),
      request: vi.fn(),
    } as any;
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

    vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};
    const result = await handleListScenarios(mockHttpClient, apiEndpoint, event);

    expect(mockHttpClient.get).toHaveBeenCalledWith(`${apiEndpoint}/scenarios`);
    expect(result).toEqual(mockScenarios);
  });

  it("should handle empty scenarios list", async () => {
    const mockResponse: HttpResponse = {
      statusCode: 200,
      body: JSON.stringify({ scenarios: [] }),
      headers: {},
    };

    vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};
    const result = await handleListScenarios(mockHttpClient, apiEndpoint, event);

    expect(result).toEqual({ scenarios: [] });
  });

  it("should throw AppError when API returns non-200 status", async () => {
    const mockResponse: HttpResponse = {
      statusCode: 500,
      body: "Internal server error",
      headers: {},
    };

    vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
      AppError
    );
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
      "Internal server error"
    );
  });

  it("should throw AppError with 404 when no scenarios found", async () => {
    const mockResponse: HttpResponse = {
      statusCode: 200,
      body: JSON.stringify(null),
      headers: {},
    };

    vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
      AppError
    );
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
      "No scenarios found"
    );

    try {
      await handleListScenarios(mockHttpClient, apiEndpoint, event);
    } catch (error) {
      expect((error as AppError).code).toBe(404);
    }
  });

  it("should throw AppError with 500 when HTTP client throws", async () => {
    vi.mocked(mockHttpClient.get).mockRejectedValue(new Error("Network error"));

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
      AppError
    );
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
      "Internal request failed"
    );

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

    vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};
    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
  });

  it("should handle malformed JSON response", async () => {
    const mockResponse: HttpResponse = {
      statusCode: 200,
      body: "invalid json",
      headers: {},
    };

    vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

    const event: AgentCoreEvent = {};

    await expect(handleListScenarios(mockHttpClient, apiEndpoint, event)).rejects.toThrow();
  });
});
