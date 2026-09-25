// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { handleUpdateSimpleSchedule } from "../../src/tools/update-simple-schedule.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

vi.mock("../../src/lib/scenario-helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRegionalTaskDetails: vi.fn().mockResolvedValue({
    "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 0, dltTaskLimit: 25, dltAvailableTasks: 25 },
  }),
  buildScenarioPayload: vi.fn().mockReturnValue({ testName: "Updated Schedule", scheduleStep: "start" }),
}));

import { buildScenarioPayload } from "../../src/lib/scenario-helpers.js";

describe("handleUpdateSimpleSchedule", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  const validEvent: AgentCoreEvent = {
    test_id: "abc1234567",
    test_name: "Updated Schedule",
    test_description: "Rescheduled test",
    test_type: "simple",
    test_task_configs: [{ region: "us-east-1", task_count: 1, concurrency: 5 }],
    test_scenario: {
      execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "Updated Schedule" }],
      scenarios: { "Updated Schedule": { requests: [{ url: "https://example.com", method: "GET" }] } },
    },
    schedule_date: "2027-02-01",
    schedule_time: "09:00",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // update_simple_schedule also passes { scheduleStep: "start" } (same as create_simple_schedule)
    it("should POST payload with scheduleStep 'start' to /scenarios", async () => {
      const mockResult = { testId: "abc1234567", status: "scheduled" };
      const mockResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify(mockResult),
        headers: {},
      };
      mockHttpClient.request.mockResolvedValue(mockResponse);

      const result = await handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, validEvent);

      expect(buildScenarioPayload).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { scheduleStep: "start" }
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
    // UpdateSimpleScheduleSchema requires test_id (unlike create where it's optional)
    it("should throw AppError for missing test_id", async () => {
      const event: AgentCoreEvent = { ...validEvent };
      delete event["test_id"];

      await expect(handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    it("should throw AppError for missing schedule_date", async () => {
      const event: AgentCoreEvent = { ...validEvent };
      delete event["schedule_date"];

      await expect(handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, event);
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

      await expect(handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);

      try {
        await handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, validEvent);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    it("should throw AppError with 500 when HTTP client throws", async () => {
      mockHttpClient.request.mockRejectedValue(new Error("Network error"));

      await expect(handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(AppError);
      await expect(handleUpdateSimpleSchedule(mockHttpClient, apiEndpoint, validEvent)).rejects.toThrow(
        "Internal request failed"
      );
    });
  });
});
