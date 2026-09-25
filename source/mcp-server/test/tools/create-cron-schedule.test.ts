// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleCreateCronSchedule } from "../../src/tools/create-cron-schedule.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

vi.mock("../../src/lib/scenario-helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRegionalTaskDetails: vi.fn().mockResolvedValue({
    "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 0, dltTaskLimit: 25, dltAvailableTasks: 25 },
  }),
  buildScenarioPayload: vi.fn().mockReturnValue({ testName: "Cron Test", scheduleStep: "create" }),
}));

import { buildScenarioPayload } from "../../src/lib/scenario-helpers.js";

describe("handleCreateCronSchedule", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  const validEvent: AgentCoreEvent = {
    test_name: "Daily Health Check",
    test_description: "Run daily at 9am",
    test_type: "simple",
    test_task_configs: [{ region: "us-east-1", task_count: 1, concurrency: 5 }],
    test_scenario: {
      execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "Daily Health Check" }],
      scenarios: { "Daily Health Check": { requests: [{ url: "https://example.com", method: "GET" }] } },
    },
    cron_value: "0 9 * * *",
    recurrence: "daily",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // create_cron_schedule passes { scheduleStep: "create" } to buildScenarioPayload
    it("should POST payload with scheduleStep 'create' to /scenarios", async () => {
      const mockResult = { testId: "abc1234567", status: "scheduled" };
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockResult),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const result = await handleCreateCronSchedule(mockHttpClient, apiEndpoint, validEvent);

      expect(buildScenarioPayload).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { scheduleStep: "create" }
      );
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: `${apiEndpoint}/scenarios`,
        })
      );
      expect(result).toEqual(mockResult);
    });

  });

  describe("Parameter validation", () => {
    // CreateCronScheduleSchema requires cron_value and recurrence in addition to standard fields
    it("should throw AppError for missing cron_value", async () => {
      const event: AgentCoreEvent = { ...validEvent };
      delete event["cron_value"];

      await expect(handleCreateCronSchedule(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleCreateCronSchedule(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for missing recurrence", async () => {
      const event: AgentCoreEvent = { ...validEvent };
      delete event["recurrence"];

      await expect(handleCreateCronSchedule(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleCreateCronSchedule(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    // cron_value now reuses the shared cronExpressionSchema.
    it("should throw AppError for a malformed cron_value", async () => {
      const event: AgentCoreEvent = { ...validEvent, cron_value: "not a cron" };

      await expect(handleCreateCronSchedule(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleCreateCronSchedule(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("cron_value");
      }
    });

  });

  describe("Error handling", () => {
    it("should throw AppError when API returns non-200 status", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 400,
        body: "Invalid cron expression",
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      await expect(handleCreateCronSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);

      try {
        await handleCreateCronSchedule(mockHttpClient, apiEndpoint, validEvent);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      mockHttpClient.request.mockRejectedValue(new Error("Network error"));

      await expect(handleCreateCronSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);
      await expect(handleCreateCronSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(
        "Internal request failed"
      );
    });
  });
});
