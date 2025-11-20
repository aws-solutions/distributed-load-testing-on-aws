// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse, IAMHttpClient } from "../../src/lib/http-client.js";
import { handleGetBaselineTestRun } from "../../src/tools/get-baseline-test-run.js";

describe("handleGetBaselineTestRun", () => {
  let mockHttpClient: IAMHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = {
      get: vi.fn(),
      request: vi.fn(),
    } as any;
  });

  describe("Successful requests", () => {
    it("should successfully get baseline test run", async () => {
      const mockBaseline = {
        testId: "test-12345",
        testRunId: "run-baseline",
        status: "completed",
        results: { avgResponseTime: 200 },
      };

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockBaseline),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      const result = await handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        `${apiEndpoint}/scenarios/test-12345/baseline`
      );
      expect(result).toEqual(mockBaseline);
    });

    it("should handle baseline with alphanumeric and dash characters", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "abc-123-xy", testRunId: "baseline-1" }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "abc-123-xy",
      };

      await expect(
        handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)
      ).resolves.toBeDefined();
    });
  });

  describe("Parameter validation", () => {
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = {};

      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for invalid test_id length", async () => {
      const event: AgentCoreEvent = {
        test_id: "short",
      };

      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("10 character");
      }
    });

    it("should throw AppError for test_id with invalid characters", async () => {
      const event: AgentCoreEvent = {
        test_id: "test_12345",
      };

      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event);
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
        body: "Baseline not found",
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Baseline not found"
      );

      try {
        await handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 404 when baseline data is null", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(null),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Baseline test run not found: test-12345"
      );

      try {
        await handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      vi.mocked(mockHttpClient.get).mockRejectedValue(new Error("Network error"));

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event);
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

      await expect(handleGetBaselineTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow();
    });
  });
});
