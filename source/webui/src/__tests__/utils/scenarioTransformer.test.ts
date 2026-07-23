// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { transformScenarioToFormData } from "../../utils/scenarioTransformer";

vi.mock("../../utils/generateUniqueId", () => ({
  generateUniqueId: vi.fn(() => "mock-id-12"),
}));

describe("transformScenarioToFormData", () => {
  const baseScenario = {
    testId: "test-123",
    testName: "My Test",
    testDescription: "Test description",
    testType: "simple",
    showLive: true,
    healthyThreshold: 85,
    tags: ["tag1", "tag2"],
    testTaskConfigs: [
      { region: "us-east-1", taskCount: 5, concurrency: 10 },
      { region: "us-west-2", taskCount: 3, concurrency: 6 },
    ],
    testScenario: {
      execution: [{ "ramp-up": "2m", "hold-for": "10m" }],
      scenarios: {
        "default-scenario": {
          requests: [
            {
              url: "https://example.com/api",
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: '{"key": "value"}',
            },
          ],
        },
      },
    },
  };

  it("transforms a scenario with preserveId=false (copy mode)", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.testName).toBe("My Test (Copy)");
    expect(result.testId).toBe("mock-id-12");
    expect(result.testDescription).toBe("Test description");
    expect(result.testType).toBe("simple");
    expect(result.showLive).toBe(true);
  });

  it("transforms a scenario with preserveId=true (edit mode)", () => {
    const result = transformScenarioToFormData(baseScenario, true);
    expect(result.testName).toBe("My Test");
    expect(result.testId).toBe("test-123");
  });

  it("maps tags to label/dismissLabel format", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.tags).toEqual([
      { label: "tag1", dismissLabel: "Remove tag1 tag" },
      { label: "tag2", dismissLabel: "Remove tag2 tag" },
    ]);
  });

  it("maps regions from testTaskConfigs", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.regions).toEqual([
      { region: "us-east-1", taskCount: "5", concurrency: "10" },
      { region: "us-west-2", taskCount: "3", concurrency: "6" },
    ]);
  });

  it("extracts HTTP endpoint and method", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.httpEndpoint).toBe("https://example.com/api");
    expect(result.httpMethod).toEqual({ label: "POST", value: "POST" });
  });

  it("extracts request headers as JSON string", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.requestHeaders).toContain("Content-Type");
  });

  it("extracts body payload", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.bodyPayload).toBe('{"key": "value"}');
  });

  it("parses ramp-up and hold-for values", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.rampUpValue).toBe("2");
    expect(result.rampUpUnit).toBe("minutes");
    expect(result.holdForValue).toBe("10");
    expect(result.holdForUnit).toBe("minutes");
  });

  it("converts healthyThreshold to string", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.healthyThreshold).toBe("85");
  });

  it("defaults healthyThreshold to '90' when not provided", () => {
    const noThreshold = { ...baseScenario, healthyThreshold: undefined };
    const result = transformScenarioToFormData(noThreshold);
    expect(result.healthyThreshold).toBe("90");
  });

  it("handles cronValue for scheduled tests", () => {
    const scheduled = {
      ...baseScenario,
      cronValue: "30 9 * * 1-5",
      cronExpiryDate: "2025-12-31",
      scheduleTimezone: "America/New_York",
    };
    const result = transformScenarioToFormData(scheduled);
    expect(result.executionTiming).toBe("run-schedule");
    expect(result.cronMinutes).toBe("30");
    expect(result.cronHours).toBe("9");
    expect(result.cronDayOfMonth).toBe("*");
    expect(result.cronMonth).toBe("*");
    expect(result.cronDayOfWeek).toBe("1-5");
    expect(result.cronExpiryDate).toBe("2025-12-31");
    expect(result.scheduleTimezone).toBe("America/New_York");
  });

  it("handles scheduleDate/scheduleTime for one-time scheduled tests", () => {
    const oneTime = {
      ...baseScenario,
      scheduleDate: "2025-06-15",
      scheduleTime: "14:30",
      scheduleTimezone: "UTC",
    };
    const result = transformScenarioToFormData(oneTime);
    expect(result.executionTiming).toBe("run-once");
    expect(result.scheduleDate).toBe("2025-06-15");
    expect(result.scheduleTime).toBe("14:30");
    expect(result.scheduleTimezone).toBe("UTC");
  });

  it("defaults executionTiming to run-now", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.executionTiming).toBe("run-now");
  });

  it("handles empty body payload (empty object)", () => {
    const scenario = {
      ...baseScenario,
      testScenario: {
        execution: [{ "hold-for": "1m" }],
        scenarios: { test: { requests: [{ url: "http://x.com", method: "GET", body: {} }] } },
      },
    };
    const result = transformScenarioToFormData(scenario);
    expect(result.bodyPayload).toBe("");
  });

  it("handles empty body payload (empty string)", () => {
    const scenario = {
      ...baseScenario,
      testScenario: {
        execution: [{ "hold-for": "1m" }],
        scenarios: { test: { requests: [{ url: "http://x.com", method: "GET", body: "" }] } },
      },
    };
    const result = transformScenarioToFormData(scenario);
    expect(result.bodyPayload).toBe("");
  });

  it("handles body payload '{}' as empty", () => {
    const scenario = {
      ...baseScenario,
      testScenario: {
        execution: [{ "hold-for": "1m" }],
        scenarios: { test: { requests: [{ url: "http://x.com", method: "GET", body: "{}" }] } },
      },
    };
    const result = transformScenarioToFormData(scenario);
    expect(result.bodyPayload).toBe("");
  });

  it("handles missing testScenario gracefully", () => {
    const minimal = { testName: "Min", testType: "simple" };
    const result = transformScenarioToFormData(minimal);
    expect(result.httpEndpoint).toBe("");
    expect(result.httpMethod).toEqual({ label: "GET", value: "GET" });
    expect(result.regions).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it("handles empty headers object", () => {
    const scenario = {
      ...baseScenario,
      testScenario: {
        execution: [{ "hold-for": "1m" }],
        scenarios: { test: { requests: [{ url: "http://x.com", method: "GET", headers: {} }] } },
      },
    };
    const result = transformScenarioToFormData(scenario);
    expect(result.requestHeaders).toBe("");
  });

  it("returns empty scriptFile when not preserving id", () => {
    const result = transformScenarioToFormData(baseScenario);
    expect(result.scriptFile).toEqual([]);
  });

  it("defaults method to GET when not specified", () => {
    const scenario = {
      ...baseScenario,
      testScenario: {
        execution: [{ "hold-for": "1m" }],
        scenarios: { test: { requests: [{ url: "http://x.com" }] } },
      },
    };
    const result = transformScenarioToFormData(scenario);
    expect(result.httpMethod).toEqual({ label: "GET", value: "GET" });
  });
});
