// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse, IAMHttpClient } from "../../src/lib/http-client.js";
import { handleGetTestRun } from "../../src/tools/get-test-run.js";

describe("handleGetTestRun", () => {
  let mockHttpClient: IAMHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = {
      get: vi.fn(),
      request: vi.fn(),
    } as any;
  });

  describe("Successful requests", () => {
    it("should successfully get test run details", async () => {
      const mockTestRun = {
        testId: "test-12345",
        testRunId: "run-123456",
        status: "completed",
        results: { avgResponseTime: 250 },
      };

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockTestRun),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
        test_run_id: "run-123456",
      };

      const result = await handleGetTestRun(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        `${apiEndpoint}/scenarios/test-12345/testruns/run-123456`
      );
      expect(result).toEqual(mockTestRun);
    });

    it("should handle test run with alphanumeric and dash characters", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testId: "abc-123-xy", testRunId: "run-456-zz" }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "abc-123-xy",
        test_run_id: "run-456-zz",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
    });
  });

  describe("Parameter validation", () => {
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = {
        test_run_id: "run-123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for missing test_run_id", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    it("should throw AppError for invalid test_id length", async () => {
      const event: AgentCoreEvent = {
        test_id: "short",
        test_run_id: "run-123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("10 character");
      }
    });

    it("should throw AppError for invalid test_run_id length", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        test_run_id: "short",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("10 character");
      }
    });

    it("should throw AppError for test_id with invalid characters", async () => {
      const event: AgentCoreEvent = {
        test_id: "test_12345",
        test_run_id: "run-123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Invalid test_id");
      }
    });

    it("should throw AppError for test_run_id with invalid characters", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        test_run_id: "run@123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Invalid test_run_id");
      }
    });
  });

  describe("Error handling", () => {
    it("should throw AppError when API returns non-200 status", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 404,
        body: "Test run not found",
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
        test_run_id: "run-123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Test run not found"
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 404 when test run data is null", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(null),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
        test_run_id: "run-123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Test run not found: test-12345/run-123456"
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      vi.mocked(mockHttpClient.get).mockRejectedValue(new Error("Network error"));

      const event: AgentCoreEvent = {
        test_id: "test-12345",
        test_run_id: "run-123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleGetTestRun(mockHttpClient, apiEndpoint, event);
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
        test_run_id: "run-123456",
      };

      await expect(handleGetTestRun(mockHttpClient, apiEndpoint, event)).rejects.toThrow();
    });
  });
});
