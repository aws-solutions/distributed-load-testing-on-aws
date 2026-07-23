// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { buildDescription, buildEndpointSection, formatDuration, MAX_DESCRIPTION_LENGTH } = require("./payload");

describe("payload - buildDescription", () => {
  const baseTestRun = {
    testId: "test-abc",
    testRunId: "run-001",
    testName: "Load Test - Checkout API",
    testType: "jmeter",
    status: "completed",
    startTime: "2026-05-20T10:00:00.000Z",
    endTime: "2026-05-20T10:10:00.000Z",
    testDuration: 600,
    concurrency: 100,
    rampUp: "1m",
    holdFor: "10m",
    testTaskConfigs: [
      { region: "us-east-1", taskCount: 5 },
      { region: "eu-west-1", taskCount: 3 },
    ],
    results: {
      total: {
        avg_rt: "0.245",
        p50_0: "0.200",
        p90_0: "0.450",
        p99_0: "0.890",
        fail: 12,
        succ: 9988,
        throughput: 10000,
        concurrency: "100",
      },
    },
  };

  it("should produce a description under 10,000 chars", () => {
    const result = buildDescription(baseTestRun, null, "https://example.com");
    expect(result.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it("should include test name and IDs", () => {
    const result = buildDescription(baseTestRun);
    expect(result).toContain("Load Test - Checkout API");
    expect(result).toContain("test-abc");
    expect(result).toContain("run-001");
  });

  it("should include test type and status", () => {
    const result = buildDescription(baseTestRun);
    expect(result).toContain("jmeter");
    expect(result).toContain("completed");
  });

  it("should include time window in ISO-8601", () => {
    const result = buildDescription(baseTestRun);
    expect(result).toContain("2026-05-20T10:00:00.000Z");
    expect(result).toContain("2026-05-20T10:10:00.000Z");
  });

  it("should include concurrency and duration", () => {
    const result = buildDescription(baseTestRun);
    expect(result).toContain("100");
    expect(result).toContain("10m");
  });

  it("should include regions with task counts", () => {
    const result = buildDescription(baseTestRun);
    expect(result).toContain("us-east-1");
    expect(result).toContain("eu-west-1");
  });

  it("should include percentiles from results", () => {
    const result = buildDescription(baseTestRun);
    expect(result).toContain("245");
    expect(result).toContain("P50");
    expect(result).toContain("P90");
    expect(result).toContain("P99");
  });

  it("should include DLT console deep link when consoleUrl is provided", () => {
    const result = buildDescription(baseTestRun, null, "https://dlt.example.com");
    expect(result).toContain("https://dlt.example.com/#/scenarios/test-abc/testruns/run-001");
  });

  it("should include user-provided additional context", () => {
    const userContext = { additionalContext: "Observed latency spike at 10:05 UTC correlating with deployment." };
    const result = buildDescription(baseTestRun, userContext);
    expect(result).toContain("Observed latency spike at 10:05 UTC");
    expect(result).toContain("Additional Context");
  });

  it("should handle results as a parsed object (not just string)", () => {
    const testRun = {
      ...baseTestRun,
      results: { total: { avg_rt: "0.100", p50_0: "0.080", p90_0: "0.200", p99_0: "0.500", fail: 0 } },
    };
    const result = buildDescription(testRun);
    expect(result).toContain("100");
    expect(result).toContain("P90");
  });

  it("should handle missing optional fields gracefully", () => {
    const minimalTestRun = { testId: "t1", testRunId: "r1" };
    const result = buildDescription(minimalTestRun);
    expect(result).toContain("t1");
    expect(result).toContain("r1");
    expect(result.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it("should truncate per-endpoint section when 100+ endpoints would exceed budget", () => {
    const endpoints = [];
    for (let i = 0; i < 150; i++) {
      endpoints.push({
        label: `/api/endpoint-${i}-with-a-long-path-to-consume-characters`,
        avg_rt: String(Math.random()),
        p50_0: "0.100",
        p90_0: "0.300",
        p99_0: "0.900",
        fail: Math.floor(Math.random() * 10),
        succ: 100,
      });
    }

    const testRun = {
      ...baseTestRun,
      results: {
        total: {
          avg_rt: "0.245",
          p50_0: "0.200",
          p90_0: "0.450",
          p99_0: "0.890",
          fail: 12,
          labels: endpoints,
        },
      },
    };

    const result = buildDescription(testRun, null, "https://dlt.example.com");
    expect(result.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(result).toContain("truncated");
  });

  it("should not include endpoint section if no endpoints exist", () => {
    const result = buildDescription(baseTestRun);
    expect(result).not.toContain("Per-Endpoint Breakdown");
  });

  it("should not throw when results is a malformed JSON string", () => {
    const testRun = { ...baseTestRun, results: "not-valid-json{{{" };
    const result = buildDescription(testRun);
    expect(result).toContain("test-abc");
    expect(result).not.toContain("Results Summary");
  });

  it("should not throw when testScenario is a malformed JSON string", () => {
    const testRun = { ...baseTestRun, testScenario: "not-valid-json{{{" };
    const result = buildDescription(testRun);
    expect(result).toContain("test-abc");
  });

  it("should include infrastructure investigation guidance when status is 'failed'", () => {
    const testRun = { ...baseTestRun, status: "failed", errorReason: "Failed to run Fargate tasks." };
    const result = buildDescription(testRun);
    expect(result).toContain("DLT Performance Investigation");
    expect(result).toContain("Investigation Guidance");
    expect(result).toContain("DLT infrastructure itself encountered a problem");
    expect(result).toContain("ECS Fargate tasks");
    expect(result).toContain("Failed to run Fargate tasks.");
  });

  it("should include errorReason in guidance section for failed tests", () => {
    const testRun = { ...baseTestRun, status: "failed", errorReason: "Task timeout exceeded." };
    const result = buildDescription(testRun);
    expect(result).toContain("**Error Reason (from DLT):** Task timeout exceeded.");
  });

  it("should include errorReason in metadata for non-failed tests with errors", () => {
    const testRun = { ...baseTestRun, status: "completed", errorReason: "Partial failure in results parsing." };
    const result = buildDescription(testRun);
    expect(result).toContain("**Error Reason:** Partial failure in results parsing.");
    expect(result).not.toContain("Investigation Guidance");
  });

  it("should not include investigation guidance when status is 'completed'", () => {
    const result = buildDescription(baseTestRun);
    expect(result).toContain("DLT Performance Investigation");
    expect(result).not.toContain("Investigation Guidance");
  });

  it("should stay under MAX_DESCRIPTION_LENGTH for failed tests with long error reasons", () => {
    const testRun = { ...baseTestRun, status: "failed", errorReason: "A".repeat(2000) };
    const result = buildDescription(testRun, null, "https://dlt.example.com");
    expect(result.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it("should include baseline comparison when a baselineRun is provided", () => {
    const baselineRun = {
      testRunId: "run-baseline",
      startTime: "2026-05-10T09:00:00.000Z",
      results: {
        total: {
          avg_rt: "0.200",
          p50_0: "0.180",
          p90_0: "0.400",
          p99_0: "0.800",
          fail: 5,
          succ: 9995,
          throughput: 10000,
        },
      },
    };
    const result = buildDescription(baseTestRun, null, null, baselineRun);
    expect(result).toContain("Baseline Comparison");
    expect(result).toContain("run-baseline");
    expect(result).toContain("2026-05-10T09:00:00.000Z");
    expect(result).toContain("Current");
    expect(result).toContain("Baseline");
    expect(result).toContain("Delta");
  });

  it("should show delta percentages with regression indicators", () => {
    const baselineRun = {
      testRunId: "run-baseline",
      results: { total: { avg_rt: "0.100", p99_0: "0.500", fail: 0, succ: 1000, throughput: 1000 } },
    };
    // Current run has 2.45x worse avg_rt and 12 failures
    const result = buildDescription(baseTestRun, null, null, baselineRun);
    expect(result).toContain("+145%"); // avg_rt: 245ms vs 100ms
    expect(result).toContain("⚠️"); // regression indicator for latency
  });

  it("should not include baseline section when baselineRun is null", () => {
    const result = buildDescription(baseTestRun, null, null, null);
    expect(result).not.toContain("Baseline Comparison");
  });

  it("should not include baseline section when baselineRun has no results", () => {
    const result = buildDescription(baseTestRun, null, null, { testRunId: "x" });
    expect(result).not.toContain("Baseline Comparison");
  });
});

describe("payload - formatDuration", () => {
  it("should format seconds-only durations", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("should format minute + second durations", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("should format exact minutes without seconds", () => {
    expect(formatDuration(120)).toBe("2m");
  });

  it("should return N/A for null", () => {
    expect(formatDuration(null)).toBe("N/A");
  });

  it("should return N/A for undefined", () => {
    expect(formatDuration(undefined)).toBe("N/A");
  });
});

describe("payload - buildEndpointSection", () => {
  it("should return empty string for null endpoints", () => {
    expect(buildEndpointSection(null, 5000)).toBe("");
  });

  it("should return empty string for empty array", () => {
    expect(buildEndpointSection([], 5000)).toBe("");
  });

  it("should sort by fail count descending", () => {
    const endpoints = [
      { label: "/low-errors", fail: 1, avg_rt: "0.100" },
      { label: "/high-errors", fail: 50, avg_rt: "0.050" },
    ];
    const result = buildEndpointSection(endpoints, 5000);
    const highIdx = result.indexOf("/high-errors");
    const lowIdx = result.indexOf("/low-errors");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("should truncate when budget is exceeded", () => {
    const endpoints = [];
    for (let i = 0; i < 50; i++) {
      endpoints.push({ label: `/api/very-long-endpoint-path-${i}`, fail: i, avg_rt: "0.100" });
    }
    const result = buildEndpointSection(endpoints, 500);
    expect(result).toContain("truncated");
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
