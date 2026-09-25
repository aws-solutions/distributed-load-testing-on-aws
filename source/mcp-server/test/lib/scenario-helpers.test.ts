// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import type { HttpResponse } from "../../src/lib/http-client.js";
import { buildScenarioPayload, fetchRegionalTaskDetails, fetchScenario } from "../../src/lib/scenario-helpers.js";
import type { ScenarioInput } from "../../src/lib/scenario-helpers.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

describe("scenario-helpers", () => {
  describe("fetchRegionalTaskDetails", () => {
    let mockHttpClient: MockHttpClient;
    const apiEndpoint = "https://api.example.com";

    beforeEach(() => {
      mockHttpClient = createMockHttpClient();
    });

    // Fetches /vCPUDetails and /tasks in parallel, merges into per-region detail objects
    it("should fetch and merge vCPU and task data into regional details", async () => {
      const vCPUResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({
          "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 20 },
        }),
        headers: {},
      };
      const tasksResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify([
          { region: "us-east-1", taskArns: ["arn:task:1", "arn:task:2"] },
        ]),
        headers: {},
      };

      mockHttpClient.get
        .mockResolvedValueOnce(vCPUResponse)
        .mockResolvedValueOnce(tasksResponse);

      const result = await fetchRegionalTaskDetails(mockHttpClient, apiEndpoint);

      expect(result["us-east-1"]).toEqual({
        vCPULimit: 100,
        vCPUsPerTask: 4,
        vCPUsInUse: 20,
        dltTaskLimit: 25,           // floor(100 / 4)
        dltAvailableTasks: 23,      // 25 - 2 running tasks
      });
    });

    // Network failure throws 500 "Failed to fetch regional task details"
    it("should throw AppError with 500 when HTTP calls throw", async () => {
      mockHttpClient.get.mockRejectedValue(new Error("Network error"));

      await expect(fetchRegionalTaskDetails(mockHttpClient, apiEndpoint)).rejects.toThrow(AppError);
      await expect(fetchRegionalTaskDetails(mockHttpClient, apiEndpoint)).rejects.toThrow(
        "Failed to fetch regional task details"
      );

      try {
        await fetchRegionalTaskDetails(mockHttpClient, apiEndpoint);
      } catch (error) {
        expect((error as AppError).code).toBe(500);
      }
    });

    // Non-200 from /vCPUDetails throws 500
    it("should throw AppError when vCPU endpoint returns non-200", async () => {
      const vCPUResponse: HttpResponse = { statusCode: 500, body: "Error", headers: {} };
      const tasksResponse: HttpResponse = { statusCode: 200, body: "[]", headers: {} };

      mockHttpClient.get
        .mockResolvedValueOnce(vCPUResponse)
        .mockResolvedValueOnce(tasksResponse);

      try {
        await fetchRegionalTaskDetails(mockHttpClient, apiEndpoint);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain("Failed to fetch vCPU details");
        expect((error as AppError).code).toBe(500);
      }
    });

    // Non-200 from /tasks throws 500
    it("should throw AppError when tasks endpoint returns non-200", async () => {
      const vCPUResponse: HttpResponse = {
        statusCode: 200,
        body: JSON.stringify({ "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 0 } }),
        headers: {},
      };
      const tasksResponse: HttpResponse = { statusCode: 500, body: "Error", headers: {} };

      mockHttpClient.get
        .mockResolvedValueOnce(vCPUResponse)
        .mockResolvedValueOnce(tasksResponse);

      try {
        await fetchRegionalTaskDetails(mockHttpClient, apiEndpoint);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain("Failed to fetch task details");
        expect((error as AppError).code).toBe(500);
      }
    });
  });

  describe("buildScenarioPayload", () => {
    const baseInput: ScenarioInput = {
      test_id: "abc1234567",
      test_name: "My Test",
      test_description: "A load test",
      test_type: "simple",
      test_task_configs: [{ region: "us-east-1", task_count: 2, concurrency: 10 }],
      test_scenario: {
        execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "Original Key" }],
        scenarios: { "Original Key": { requests: [{ url: "https://example.com", method: "GET" }] } },
      },
    };

    const mockRegionalDetails = {
      "us-east-1": { vCPULimit: 100, vCPUsPerTask: 4, vCPUsInUse: 0, dltTaskLimit: 25, dltAvailableTasks: 25 },
    };

    // Transforms snake_case params to camelCase, adds fileType based on test_type
    it("should transform params to camelCase payload", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails);

      expect(result["testId"]).toBe("abc1234567");
      expect(result["testName"]).toBe("My Test");
      expect(result["testDescription"]).toBe("A load test");
      expect(result["testType"]).toBe("simple");
      expect(result["fileType"]).toBe("none"); // "simple" → "none"
      expect(result["regionalTaskDetails"]).toEqual(mockRegionalDetails);
    });

    // Non-simple test whose script asset is a plain script (no .zip) → fileType = "script"
    it("should set fileType to 'script' for non-simple test types with a script asset", () => {
      const input = {
        ...baseInput,
        test_type: "jmeter",
        test_scenario: {
          execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "My Test" }],
          scenarios: { "My Test": { script: "abc1234567.jmx" } },
        },
      };
      const result = buildScenarioPayload(input, mockRegionalDetails);
      expect(result["fileType"]).toBe("script");
    });

    // A non-simple test whose referenced script asset is a .zip must send fileType "zip",
    // so the API's asset check looks for the uploaded zip object instead of a bare script
    // (which it would never find, returning 400 and orphaning the uploaded zip in S3).
    it("should set fileType to 'zip' when the referenced script asset is a .zip", () => {
      const input = {
        ...baseInput,
        test_type: "jmeter",
        test_scenario: {
          execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "My Test" }],
          scenarios: { "My Test": { script: "abc1234567.zip" } },
        },
      };
      const result = buildScenarioPayload(input, mockRegionalDetails);
      expect(result["fileType"]).toBe("zip");
    });

    // The .zip detection is case-insensitive on the extension.
    it("should treat an uppercase .ZIP extension as a zip asset", () => {
      const input = {
        ...baseInput,
        test_type: "locust",
        test_scenario: {
          execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "My Test" }],
          scenarios: { "My Test": { script: "abc1234567.ZIP" } },
        },
      };
      const result = buildScenarioPayload(input, mockRegionalDetails);
      expect(result["fileType"]).toBe("zip");
    });

    // A simple (inline) test never carries an asset, even if a stray .zip-looking
    // value appears in its scenario — fileType stays "none".
    it("should keep fileType 'none' for simple tests regardless of scenario contents", () => {
      const input = {
        ...baseInput,
        test_type: "simple",
        test_scenario: {
          execution: [{ "ramp-up": "10s", "hold-for": "1m", scenario: "My Test" }],
          scenarios: { "My Test": { script: "abc1234567.zip" } },
        },
      };
      const result = buildScenarioPayload(input, mockRegionalDetails);
      expect(result["fileType"]).toBe("none");
    });

    // test_task_configs are transformed from snake_case to camelCase
    it("should transform test_task_configs to camelCase", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails);
      const configs = result["testTaskConfigs"] as Array<Record<string, unknown>>;
      expect(configs[0]).toEqual({ region: "us-east-1", taskCount: 2, concurrency: 10 });
    });

    // Normalizes scenario key: renames the single scenario key to match test_name
    it("should normalize scenario key to match test_name", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails);
      const scenario = result["testScenario"] as Record<string, unknown>;
      const scenarios = scenario["scenarios"] as Record<string, unknown>;

      expect(scenarios["My Test"]).toBeDefined();
      expect(scenarios["Original Key"]).toBeUndefined();
    });

    // Normalizes execution[].scenario to match test_name
    it("should normalize execution scenario reference to match test_name", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails);
      const scenario = result["testScenario"] as Record<string, unknown>;
      const execution = scenario["execution"] as Array<Record<string, unknown>>;

      expect(execution[0]["scenario"]).toBe("My Test");
    });

    // Script-based tests get executor injected so Taurus doesn't fall back to jmeter
    it("should inject executor matching test_type for script-based tests", () => {
      for (const testType of ["jmeter", "locust", "k6"]) {
        const input = { ...baseInput, test_type: testType };
        const result = buildScenarioPayload(input, mockRegionalDetails);
        const scenario = result["testScenario"] as Record<string, unknown>;
        const execution = scenario["execution"] as Array<Record<string, unknown>>;

        expect(execution[0]["executor"]).toBe(testType);
      }
    });

    // Simple tests run under Taurus's default executor; no executor field is added
    it("should not inject executor for simple tests", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails);
      const scenario = result["testScenario"] as Record<string, unknown>;
      const execution = scenario["execution"] as Array<Record<string, unknown>>;

      expect(execution[0]).not.toHaveProperty("executor");
    });

    // saveOnly option is included when passed
    it("should include saveOnly when option is set", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails, { saveOnly: true });
      expect(result["saveOnly"]).toBe(true);
    });

    // scheduleStep option is included when passed
    it("should include scheduleStep when option is set", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails, { scheduleStep: "create" });
      expect(result["scheduleStep"]).toBe("create");
    });

    // Schedule fields are included when present in input
    it("should include schedule fields when provided", () => {
      const input: ScenarioInput = {
        ...baseInput,
        schedule_date: "2027-01-15",
        schedule_time: "14:00",
        schedule_timezone: "America/New_York",
        cron_value: "0 9 * * *",
        recurrence: "daily",
        cron_expiry_date: "2028-01-01",
      };

      const result = buildScenarioPayload(input, mockRegionalDetails);

      expect(result["scheduleDate"]).toBe("2027-01-15");
      expect(result["scheduleTime"]).toBe("14:00");
      expect(result["scheduleTimezone"]).toBe("America/New_York");
      expect(result["cronValue"]).toBe("0 9 * * *");
      expect(result["recurrence"]).toBe("daily");
      expect(result["cronExpiryDate"]).toBe("2028-01-01");
    });

    // Optional fields (tags, healthy_threshold, show_live) are handled correctly
    it("should include tags and healthy_threshold when provided", () => {
      const input: ScenarioInput = {
        ...baseInput,
        tags: ["perf", "nightly"],
        healthy_threshold: 80,
        show_live: true,
      };

      const result = buildScenarioPayload(input, mockRegionalDetails);

      expect(result["tags"]).toEqual(["perf", "nightly"]);
      expect(result["healthyThreshold"]).toBe(80);
      expect(result["showLive"]).toBe(true);
    });

    // native_run_mode is passed through unchanged as nativeRunMode
    it("should include nativeRunMode when native_run_mode is provided", () => {
      const input: ScenarioInput = {
        ...baseInput,
        test_type: "locust",
        native_run_mode: {
          maxTestDurationSeconds: 3600,
        },
      };

      const result = buildScenarioPayload(input, mockRegionalDetails);

      expect(result["nativeRunMode"]).toEqual({
        maxTestDurationSeconds: 3600,
      });
    });

    // Legacy (Taurus) tests omit nativeRunMode entirely
    it("should omit nativeRunMode when native_run_mode is absent", () => {
      const result = buildScenarioPayload(baseInput, mockRegionalDetails);
      expect(result).not.toHaveProperty("nativeRunMode");
    });

  });

  describe("fetchScenario", () => {
    let mockHttpClient: MockHttpClient;
    const apiEndpoint = "https://api.example.com";

    beforeEach(() => {
      mockHttpClient = createMockHttpClient();
    });

    // 200 with a valid scenario body returns the parsed record
    it("should return the parsed scenario on 200", async () => {
      mockHttpClient.get.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ testId: "abc", testType: "k6" }),
        headers: {},
      });

      const result = await fetchScenario(mockHttpClient, apiEndpoint, "abc", "Test not found: abc");

      expect(result.testType).toBe("k6");
    });

    // Non-200 propagates the upstream status and body verbatim
    it("should throw an AppError carrying the upstream status on non-200", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 404, body: "nope", headers: {} });

      await expect(fetchScenario(mockHttpClient, apiEndpoint, "abc", "Test not found: abc")).rejects.toMatchObject({
        code: 404,
        message: "nope",
      });
    });

    // A 200 with a null body means the test does not exist -> 404
    it("should throw 404 when the body is null", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: "null", headers: {} });

      await expect(fetchScenario(mockHttpClient, apiEndpoint, "abc", "Test not found: abc")).rejects.toMatchObject({
        code: 404,
        message: "Test not found: abc",
      });
    });

    // A 200 with a non-JSON body is guarded and surfaces as a 500 AppError
    // rather than a raw SyntaxError.
    it("should throw 500 when the body is not valid JSON", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: "<html>oops</html>", headers: {} });

      await expect(fetchScenario(mockHttpClient, apiEndpoint, "abc", "Test not found: abc")).rejects.toMatchObject({
        code: 500,
      });
    });

    // A network/transport failure surfaces as a 500 AppError
    it("should throw 500 when the request fails", async () => {
      mockHttpClient.get.mockRejectedValue(new Error("network down"));

      await expect(fetchScenario(mockHttpClient, apiEndpoint, "abc", "Test not found: abc")).rejects.toMatchObject({
        code: 500,
      });
    });
  });
});
