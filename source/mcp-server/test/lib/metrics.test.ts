// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    approximateTokenCount,
    sendToolUsageMetric,
    toolUsageMetricSchemaVersion,
    toolUsageMetricType,
    toolUsageUserAgent,
} from "../../src/lib/metrics.js";

// Mock config module
vi.mock("../../src/lib/config.js", () => ({
  getSolutionId: vi.fn(() => "test-solution-id"),
  getUuid: vi.fn(() => "test-uuid"),
  getVersion: vi.fn(() => "1.0.0"),
  getMetricUrl: vi.fn(() => "https://metrics.example.com"),
}));

// Mock fetch
global.fetch = vi.fn();

describe("Metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("approximateTokenCount", () => {
    it("should calculate token count using 4 characters per token", () => {
      expect(approximateTokenCount("test")).toBe(1);
      expect(approximateTokenCount("testing")).toBe(2);
      expect(approximateTokenCount("a".repeat(4))).toBe(1);
      expect(approximateTokenCount("a".repeat(5))).toBe(2);
    });

    it("should handle empty string", () => {
      expect(approximateTokenCount("")).toBe(0);
    });

    it("should round up for partial tokens", () => {
      expect(approximateTokenCount("abc")).toBe(1);
      expect(approximateTokenCount("abcde")).toBe(2);
    });

    it("should handle long text", () => {
      const longText = "a".repeat(1000);
      expect(approximateTokenCount(longText)).toBe(250);
    });
  });

  describe("sendToolUsageMetric", () => {
    it("should send metric successfully", async () => {
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
        statusText: "OK",
      } as Response);

      const metric = {
        Type: toolUsageMetricType,
        MetricSchemaVersion: toolUsageMetricSchemaVersion,
        UserAgent: toolUsageUserAgent,
        ToolName: "test_tool",
        TokenCount: 100,
        DurationMs: 500,
        Status: "success" as const,
        StatusCode: 200,
      };

      await sendToolUsageMetric(metric);

      expect(fetch).toHaveBeenCalledWith(
        "https://metrics.example.com",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);

      expect(body.Solution).toBe("test-solution-id");
      expect(body.UUID).toBe("test-uuid");
      expect(body.Version).toBe("1.0.0");
      expect(body.Data).toEqual(metric);
      expect(body.TimeStamp).toBeDefined();
    });

    it("should format timestamp correctly", async () => {
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
        statusText: "OK",
      } as Response);

      const metric = {
        Type: toolUsageMetricType,
        MetricSchemaVersion: toolUsageMetricSchemaVersion,
        UserAgent: toolUsageUserAgent,
        ToolName: "test_tool",
        TokenCount: 100,
        DurationMs: 500,
        Status: "success" as const,
        StatusCode: 200,
      };

      await sendToolUsageMetric(metric);

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);

      // Timestamp should be in format: "YYYY-MM-DD HH:mm:ss.SSS"
      expect(body.TimeStamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    });

    it("should log error when metric service returns non-200", async () => {
      vi.mocked(fetch).mockResolvedValue({
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const metric = {
        Type: toolUsageMetricType,
        MetricSchemaVersion: toolUsageMetricSchemaVersion,
        UserAgent: toolUsageUserAgent,
        ToolName: "test_tool",
        TokenCount: 100,
        DurationMs: 500,
        Status: "success" as const,
        StatusCode: 200,
      };

      await sendToolUsageMetric(metric);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send tool usage metrics: 500")
      );
    });

    it("should silently catch network errors", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      const metric = {
        Type: toolUsageMetricType,
        MetricSchemaVersion: toolUsageMetricSchemaVersion,
        UserAgent: toolUsageUserAgent,
        ToolName: "test_tool",
        TokenCount: 100,
        DurationMs: 500,
        Status: "failure" as const,
        StatusCode: 500,
      };

      await expect(sendToolUsageMetric(metric)).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(
        "Failed to send tool usage metrics:",
        expect.any(Error)
      );
    });

    it("should handle failure metrics", async () => {
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
        statusText: "OK",
      } as Response);

      const metric = {
        Type: toolUsageMetricType,
        MetricSchemaVersion: toolUsageMetricSchemaVersion,
        UserAgent: toolUsageUserAgent,
        ToolName: "test_tool",
        TokenCount: 50,
        DurationMs: 250,
        Status: "failure" as const,
        StatusCode: 404,
      };

      await sendToolUsageMetric(metric);

      expect(fetch).toHaveBeenCalled();
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);

      expect(body.Data.Status).toBe("failure");
      expect(body.Data.StatusCode).toBe(404);
    });
  });

  describe("Constants", () => {
    it("should have correct metric type", () => {
      expect(toolUsageMetricType).toBe("ToolUsage");
    });

    it("should have correct schema version", () => {
      expect(toolUsageMetricSchemaVersion).toBe(1);
    });

    it("should have correct user agent", () => {
      expect(toolUsageUserAgent).toBe("dlt-mcp-server");
    });
  });
});
