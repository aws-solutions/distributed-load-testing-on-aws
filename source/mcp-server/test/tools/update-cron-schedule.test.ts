// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleUpdateCronSchedule } from "../../src/tools/update-cron-schedule.js";
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

describe("handleUpdateCronSchedule", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  const validEvent: AgentCoreEvent = {
    test_id: "abc1234567",
    test_name: "Updated Cron Test",
    test_description: "Updated recurring test",
    test_type: "simple",
    test_task_configs: [{ region: "us-east-1", task_count: 1, concurrency: 5 }],
    test_scenario: {
      execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "Updated Cron Test" }],
      scenarios: { "Updated Cron Test": { requests: [{ url: "https://example.com", method: "GET" }] } },
    },
    cron_value: "0 10 * * *",
    recurrence: "daily",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // update_cron_schedule also passes { scheduleStep: "create" } (same as create_cron_schedule)
    it("should POST payload with scheduleStep 'create' to /scenarios", async () => {
      const mockResult = { testId: "abc1234567", status: "scheduled" };
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockResult),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const result = await handleUpdateCronSchedule(mockHttpClient, apiEndpoint, validEvent);

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
    // UpdateCronScheduleSchema requires test_id (unlike create where it's optional)
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = { ...validEvent };
      delete event["test_id"];

      await expect(handleUpdateCronSchedule(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUpdateCronSchedule(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for missing cron_value", async () => {
      const event: AgentCoreEvent = { ...validEvent };
      delete event["cron_value"];

      await expect(handleUpdateCronSchedule(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUpdateCronSchedule(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });
  });

  describe("Error handling", () => {
    it("should throw AppError when API returns non-200 status", async () => {
      const mockResponse: HttpResponse = {
        statusCode: 400,
        body: "Bad request",
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      await expect(handleUpdateCronSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);

      try {
        await handleUpdateCronSchedule(mockHttpClient, apiEndpoint, validEvent);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      mockHttpClient.request.mockRejectedValue(new Error("Network error"));

      await expect(handleUpdateCronSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);
      await expect(handleUpdateCronSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(
        "Internal request failed"
      );
    });
  });
});
