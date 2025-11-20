// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse, IAMHttpClient } from "../../src/lib/http-client.js";
import { handleListTestRuns } from "../../src/tools/list-test-runs.js";

describe("handleListTestRuns", () => {
  let mockHttpClient: IAMHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = {
      get: vi.fn(),
      request: vi.fn(),
    } as any;
  });

  describe("Successful requests", () => {
    it("should successfully list test runs with default limit", async () => {
      const mockTestRuns = [
        { testRunId: "run-001", status: "completed" },
        { testRunId: "run-002", status: "running" },
      ];

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: mockTestRuns }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      const result = await handleListTestRuns(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining(`${apiEndpoint}/scenarios/test-12345/testruns`)
      );
      expect(mockHttpClient.get).toHaveBeenCalledWith(expect.stringContaining("limit=30"));
      expect(mockHttpClient.get).toHaveBeenCalledWith(expect.stringContaining("end_timestamp="));
      expect(result).toEqual(mockTestRuns);
    });

    it("should successfully list test runs with custom limit", async () => {
      const mockTestRuns = [{ testRunId: "run-001" }];

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: mockTestRuns }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
        limit: 10,
      };

      const result = await handleListTestRuns(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(expect.stringContaining("limit=10"));
      expect(result).toEqual(mockTestRuns);
    });

    it("should successfully list test runs with start_timestamp", async () => {
      const mockTestRuns = [{ testRunId: "run-001" }];

      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: mockTestRuns }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
        start_timestamp: "2024-01-01T00:00:00.000Z",
      };

      const result = await handleListTestRuns(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining("start_timestamp=2024-01-01T00%3A00%3A00.000Z")
      );
      expect(mockHttpClient.get).toHaveBeenCalledWith(expect.stringContaining("limit=30"));
      expect(result).toEqual(mockTestRuns);
    });

    it("should include end_timestamp in query", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: [{ testRunId: "run-001" }] }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await handleListTestRuns(mockHttpClient, apiEndpoint, event);

      expect(mockHttpClient.get).toHaveBeenCalledWith(expect.stringContaining("end_timestamp="));
    });

    it("should handle test runs with alphanumeric and dash characters", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ testRuns: [{ testId: "abc-123-xy" }] }),
        headers: {},
      };

      vi.mocked(mockHttpClient.get).mockResolvedValue(mockResponse);

      const event: AgentCoreEvent = {
        test_id: "abc-123-xy",
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).resolves.toBeDefined();
    });
  });

  describe("Parameter validation", () => {
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = {};

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for invalid test_id length", async () => {
      const event: AgentCoreEvent = {
        test_id: "short",
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("10 character");
      }
    });

    it("should throw AppError for test_id with invalid characters", async () => {
      const event: AgentCoreEvent = {
        test_id: "test_12345",
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Invalid test_id");
      }
    });

    it("should throw AppError for negative limit", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        limit: -1,
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    it("should throw AppError for limit exceeding maximum", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        limit: 31,
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("limit must be an integer between 1 and 30");
      }
    });

    it("should throw AppError for zero limit", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        limit: 0,
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    it("should throw AppError for non-integer limit", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        limit: 10.5,
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    it("should throw AppError for invalid start_timestamp format", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        start_timestamp: "2024-01-01",
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("ISO 8601 timestamp");
      }
    });

    it("should throw AppError when both limit and start_timestamp are provided", async () => {
      const event: AgentCoreEvent = {
        test_id: "test-12345",
        limit: 10,
        start_timestamp: "2024-01-01T00:00:00.000Z",
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain(
          "Cannot use both limit and start_timestamp"
        );
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

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Test not found"
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
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

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Test runs not found: test-12345"
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
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

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "No test runs found for test_id: test-12345"
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
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

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "No test runs found for test_id: test-12345"
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      vi.mocked(mockHttpClient.get).mockRejectedValue(new Error("Network error"));

      const event: AgentCoreEvent = {
        test_id: "test-12345",
      };

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        AppError
      );
      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Internal request failed"
      );

      try {
        await handleListTestRuns(mockHttpClient, apiEndpoint, event);
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

      await expect(handleListTestRuns(mockHttpClient, apiEndpoint, event)).rejects.toThrow();
    });
  });
});
