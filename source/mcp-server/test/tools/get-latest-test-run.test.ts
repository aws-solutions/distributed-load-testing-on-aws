// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse, IAMHttpClient } from "../../src/lib/http-client.js";
import { handleGetLatestTestRun } from "../../src/tools/get-latest-test-run.js";

describe("handleGetLatestTestRun", () => {
  let mockHttpClient: IAMHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = {
      get: vi.fn(),
      request: vi.fn(),
    } as any;
  });

  describe("Successful requests", () => {
    it("should successfully get latest test run", async () => {
      const mockLatestRun = {
        testId: "test-12345",
        testRunId: "run-latest",
        status: "completed",
        results: { avgResponseTime: 250 },
      };

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: [mockLatestRun] }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      const result = await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        `${apiEndpoint}/scenarios/test-12345/testruns?limit=1`
      );
      expect(result).toEqual(mockLatestRun);
    });

    it("should return first test run from array", async () => {
      const mockRuns = [
        { testRunId: "run-001", timestamp: "2024-01-02" },
        { testRunId: "run-002", timestamp: "2024-01-01" },
      ];

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: mockRuns }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      const result = await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);

      expect(result).toEqual(mockRuns[0]);
    });

    it("should handle test run with alphanumeric and dash characters", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({
          testRuns: [{ testId: "abc-123-xy", testRunId: "run-latest" }],
        }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "abc-123-xy",
      };

      await expect(
        handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)
      ).resolves.toBeDefined();
    });
  });

  describe("Parameter validation", () => {
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = {};

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for invalid test_id length", async () => {
      const event: AgentCoreEvent = {
        test_id: "short",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("10 character");
      }
    });

    it("should throw AppError for test_id with invalid characters", async () => {
      const event: AgentCoreEvent = {
        test_id: "test_12345",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Invalid test_id");
      }
    });
  });

  describe("Error handling", () => {
    it("should throw AppError when API returns non-200 status", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 404,
        body: "Test not found",
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Test not found"
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 404 when response data is null", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(null),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Test run data not found: test-12345"
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 404 when testRuns array is missing", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({}),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "No test runs found for test_id: test-12345"
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 404 when testRuns array is empty", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: [] }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "No test runs found for test_id: test-12345"
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      vi.mocked(mockHttpClient.get).mockRejectedValue(new Error("Network error"));

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleGetLatestTestRun(mockHttpClient, apiEndpoint, event);
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

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetLatestTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow();
    });
  });
});
