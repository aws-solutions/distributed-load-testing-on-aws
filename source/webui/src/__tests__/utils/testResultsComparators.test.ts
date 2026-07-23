// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test, vi } from "vitest";
import {
  calculateMetricDelta,
  calculateBaselineComparison,
  findMatchingBaselineData,
  calculateAggregatedBaseline,
} from "../../pages/scenarios/utils/testResultsComparators";
import { ViewMode } from "../../pages/scenarios/types/viewMode";

vi.mock("../../pages/scenarios/utils/testResultsTransformers", () => ({
  aggregateBaselineMetrics: vi.fn((_total, _duration) => ({
    requests: 100,
    success: 95,
    successRate: 95,
    avgRespTime: 200,
    p95RespTime: 400,
    errors: 5,
    requestsPerSecond: 10,
    avgLatency: 150,
    avgConnectionTime: 50,
    avgBandwidth: 1024,
    p0RespTime: 50,
    p50RespTime: 180,
    p90RespTime: 350,
    p99RespTime: 450,
    p99_9RespTime: 480,
    p100RespTime: 500,
  })),
}));

describe("calculateMetricDelta", () => {
  test("returns null when currentValue is undefined", () => {
    expect(calculateMetricDelta(undefined, 100)).toBeNull();
  });

  test("returns null when baselineValue is undefined", () => {
    expect(calculateMetricDelta(100, undefined)).toBeNull();
  });

  test("returns null when baselineValue is zero", () => {
    expect(calculateMetricDelta(50, 0)).toBeNull();
  });

  test("calculates positive delta correctly", () => {
    const result = calculateMetricDelta(150, 100);
    expect(result).not.toBeNull();
    expect(result!.delta).toBe(50);
    expect(result!.deltaText).toBe("+50%");
  });

  test("calculates negative delta correctly", () => {
    const result = calculateMetricDelta(50, 100);
    expect(result).not.toBeNull();
    expect(result!.delta).toBe(-50);
    expect(result!.deltaText).toBe("-50%");
  });

  test("calculates zero delta", () => {
    const result = calculateMetricDelta(100, 100);
    expect(result).not.toBeNull();
    expect(result!.delta).toBe(0);
    expect(result!.deltaText).toBe("0%");
  });
});

describe("findMatchingBaselineData", () => {
  test("returns null when baseline is undefined", () => {
    expect(findMatchingBaselineData("us-east-1", "label1", undefined, ViewMode.ByEndpoint)).toBeNull();
  });

  test("returns null when baseline has no results", () => {
    const baseline = { testRunDetails: {} } as any;
    expect(findMatchingBaselineData("us-east-1", "label1", baseline, ViewMode.ByEndpoint)).toBeNull();
  });

  test("returns aggregated metrics for Overall mode with total region", () => {
    const baseline = {
      testRunDetails: {
        results: {
          total: { testDuration: "10", throughput: 100 },
        },
      },
    } as any;
    const result = findMatchingBaselineData("total", "", baseline, ViewMode.Overall);
    expect(result).not.toBeNull();
    expect((result as any).requests).toBe(100);
  });

  test("returns null for Overall mode when total is missing", () => {
    const baseline = {
      testRunDetails: { results: {} },
    } as any;
    expect(findMatchingBaselineData("total", "", baseline, ViewMode.Overall)).toBeNull();
  });

  test("returns matching label for individual lookup", () => {
    const baseline = {
      testRunDetails: {
        results: {
          "us-east-1": {
            labels: [
              { label: "endpoint-a", throughput: 50 },
              { label: "endpoint-b", throughput: 30 },
            ],
          },
        },
      },
    } as any;
    const result = findMatchingBaselineData("us-east-1", "endpoint-a", baseline, ViewMode.ByEndpoint);
    expect(result).not.toBeNull();
    expect((result as any).label).toBe("endpoint-a");
  });

  test("returns null when region has no labels", () => {
    const baseline = {
      testRunDetails: {
        results: { "us-east-1": {} },
      },
    } as any;
    expect(findMatchingBaselineData("us-east-1", "endpoint-a", baseline, ViewMode.ByEndpoint)).toBeNull();
  });

  test("returns null when label not found", () => {
    const baseline = {
      testRunDetails: {
        results: {
          "us-east-1": {
            labels: [{ label: "endpoint-a" }],
          },
        },
      },
    } as any;
    expect(findMatchingBaselineData("us-east-1", "nonexistent", baseline, ViewMode.ByEndpoint)).toBeNull();
  });
});

describe("calculateBaselineComparison", () => {
  const currentRow = {
    requests: 200,
    success: 190,
    successRate: 95,
    avgRespTime: 250,
    p95RespTime: 500,
    errors: 10,
    requestsPerSecond: 20,
    avgLatency: 180,
    avgConnectionTime: 60,
    avgBandwidth: 2048,
    p0RespTime: 60,
    p50RespTime: 200,
    p90RespTime: 400,
    p99RespTime: 500,
    p99_9RespTime: 550,
    p100RespTime: 600,
  };

  test("returns undefined when baselineData is null", () => {
    expect(calculateBaselineComparison(currentRow, null)).toBeUndefined();
  });

  test("calculates comparison from LabelMetrics (has throughput field)", () => {
    const labelMetrics = {
      throughput: 100,
      succ: 95,
      fail: 5,
      avg_rt: "0.2",
      p95_0: "0.4",
      avg_lt: "0.15",
      avg_ct: "0.05",
      bytes: "10240",
      testDuration: "10",
      p0_0: "0.05",
      p50_0: "0.18",
      p90_0: "0.35",
      p99_0: "0.45",
      p99_9: "0.48",
      p100_0: "0.5",
    } as any;

    const result = calculateBaselineComparison(currentRow, labelMetrics);
    expect(result).toBeDefined();
    expect(result!.requests).toBe(100);
    expect(result!.success).toBe(95);
    expect(result!.errors).toBe(5);
    expect(result!.avgRespTime).toBe(200);
    expect(result!.requestsPerSecond).toBe(10);
    expect(result!.avgBandwidth).toBeCloseTo(1);
  });

  test("handles zero testDuration in LabelMetrics", () => {
    const labelMetrics = {
      throughput: 100,
      succ: 95,
      fail: 5,
      avg_rt: "0.2",
      p95_0: "0.4",
      avg_lt: "0.15",
      avg_ct: "0.05",
      bytes: "10240",
      testDuration: "0",
      p0_0: "0.05",
      p50_0: "0.18",
      p90_0: "0.35",
      p99_0: "0.45",
      p99_9: "0.48",
      p100_0: "0.5",
    } as any;

    const result = calculateBaselineComparison(currentRow, labelMetrics);
    expect(result!.requestsPerSecond).toBe(0);
    expect(result!.avgBandwidth).toBe(0);
  });

  test("calculates comparison from AggregateMetrics (no throughput field)", () => {
    const aggregateMetrics = {
      requests: 100,
      success: 95,
      successRate: 95,
      avgRespTime: 200,
      p95RespTime: 400,
      errors: 5,
      requestsPerSecond: 10,
      avgLatency: 150,
      avgConnectionTime: 50,
      avgBandwidth: 1024,
      p0RespTime: 50,
      p50RespTime: 180,
      p90RespTime: 350,
      p99RespTime: 450,
      p99_9RespTime: 480,
      p100RespTime: 500,
    };

    const result = calculateBaselineComparison(currentRow, aggregateMetrics);
    expect(result).toBeDefined();
    expect(result!.requests).toBe(100);
    expect(result!.avgRespTime).toBe(200);
    expect(result!.p99_9RespTime).toBe(480);
  });
});

describe("calculateAggregatedBaseline", () => {
  test("returns null when baseline is undefined", () => {
    expect(calculateAggregatedBaseline(undefined)).toBeNull();
  });

  test("returns null when results.total is missing", () => {
    const baseline = { testRunDetails: { results: {} } } as any;
    expect(calculateAggregatedBaseline(baseline)).toBeNull();
  });

  test("returns aggregated metrics when total exists", () => {
    const baseline = {
      testRunDetails: {
        results: {
          total: { testDuration: "10", throughput: 100 },
        },
      },
    } as any;
    const result = calculateAggregatedBaseline(baseline);
    expect(result).not.toBeNull();
    expect(result!.requests).toBe(100);
  });
});
