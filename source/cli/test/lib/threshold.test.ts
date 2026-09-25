// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseThresholdFlags, evaluateThresholds, evaluateBaselineRegression } from "../../src/lib/threshold.js";
import type { ThresholdConfig } from "../../src/lib/threshold.js";
import type { TestResultsData } from "../../src/lib/types.js";

// ---------------------------------------------------------------------------
// parseThresholdFlags
// ---------------------------------------------------------------------------

describe("parseThresholdFlags", () => {
  describe("failOnErrorRate", () => {
    it("parses valid error rate at 0", () => {
      const config = parseThresholdFlags({ failOnErrorRate: "0" });
      expect(config.failOnErrorRate).toBe(0);
    });

    it("parses valid error rate at 100", () => {
      const config = parseThresholdFlags({ failOnErrorRate: "100" });
      expect(config.failOnErrorRate).toBe(100);
    });

    it("parses valid error rate at 5.5", () => {
      const config = parseThresholdFlags({ failOnErrorRate: "5.5" });
      expect(config.failOnErrorRate).toBe(5.5);
    });

    it("throws for error rate above 100", () => {
      expect(() => parseThresholdFlags({ failOnErrorRate: "101" })).toThrow("must be between 0 and 100");
    });

    it("throws for negative error rate", () => {
      expect(() => parseThresholdFlags({ failOnErrorRate: "-1" })).toThrow("must be between 0 and 100");
    });

    it("throws for non-numeric error rate", () => {
      expect(() => parseThresholdFlags({ failOnErrorRate: "abc" })).toThrow("must be a numeric value");
    });
  });

  describe("failOnP99", () => {
    it("parses valid p99 threshold", () => {
      const config = parseThresholdFlags({ failOnP99: "500" });
      expect(config.failOnP99).toBe(500);
    });

    it("throws for p99 of 0", () => {
      expect(() => parseThresholdFlags({ failOnP99: "0" })).toThrow("must be greater than 0");
    });

    it("throws for negative p99", () => {
      expect(() => parseThresholdFlags({ failOnP99: "-10" })).toThrow("must be greater than 0");
    });

    it("throws for non-numeric p99", () => {
      expect(() => parseThresholdFlags({ failOnP99: "fast" })).toThrow("must be a numeric value");
    });
  });

  describe("failOnP95", () => {
    it("parses valid p95 threshold", () => {
      const config = parseThresholdFlags({ failOnP95: "200" });
      expect(config.failOnP95).toBe(200);
    });

    it("throws for p95 of 0", () => {
      expect(() => parseThresholdFlags({ failOnP95: "0" })).toThrow("must be greater than 0");
    });

    it("throws for negative p95", () => {
      expect(() => parseThresholdFlags({ failOnP95: "-5" })).toThrow("must be greater than 0");
    });
  });

  describe("failOnAvgRt", () => {
    it("parses valid avg_rt threshold", () => {
      const config = parseThresholdFlags({ failOnAvgRt: "100" });
      expect(config.failOnAvgRt).toBe(100);
    });

    it("throws for avg_rt of 0", () => {
      expect(() => parseThresholdFlags({ failOnAvgRt: "0" })).toThrow("must be greater than 0");
    });

    it("throws for non-numeric avg_rt", () => {
      expect(() => parseThresholdFlags({ failOnAvgRt: "slow" })).toThrow("must be a numeric value");
    });
  });

  describe("failOnThroughputBelow", () => {
    it("parses valid throughput threshold", () => {
      const config = parseThresholdFlags({ failOnThroughputBelow: "50" });
      expect(config.failOnThroughputBelow).toBe(50);
    });

    it("throws for throughput of 0", () => {
      expect(() => parseThresholdFlags({ failOnThroughputBelow: "0" })).toThrow("must be greater than 0");
    });

    it("throws for negative throughput", () => {
      expect(() => parseThresholdFlags({ failOnThroughputBelow: "-1" })).toThrow("must be greater than 0");
    });
  });

  describe("failOnBaselineRegression", () => {
    it("parses valid baseline regression threshold", () => {
      const config = parseThresholdFlags({ failOnBaselineRegression: "20" });
      expect(config.failOnBaselineRegression).toBe(20);
    });

    it("throws for baseline regression of 0", () => {
      expect(() => parseThresholdFlags({ failOnBaselineRegression: "0" })).toThrow("must be greater than 0");
    });

    it("throws for negative baseline regression", () => {
      expect(() => parseThresholdFlags({ failOnBaselineRegression: "-10" })).toThrow("must be greater than 0");
    });
  });

  describe("multiple flags", () => {
    it("parses multiple valid thresholds", () => {
      const config = parseThresholdFlags({
        failOnErrorRate: "5",
        failOnP99: "1000",
        failOnThroughputBelow: "10",
      });
      expect(config.failOnErrorRate).toBe(5);
      expect(config.failOnP99).toBe(1000);
      expect(config.failOnThroughputBelow).toBe(10);
    });

    it("returns empty config when no flags provided", () => {
      const config = parseThresholdFlags({});
      expect(config).toEqual({});
    });

    it("ignores undefined values", () => {
      const config = parseThresholdFlags({ failOnP99: undefined });
      expect(config).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateThresholds
// ---------------------------------------------------------------------------

describe("evaluateThresholds", () => {
  const baseResults: TestResultsData = {
    succ: 950,
    fail: 50,
    throughput: 100,
    avg_rt: "120.5",
    p50_0: "80",
    p90_0: "150",
    p99_0: "350",
    p95_0: "200",
  };

  describe("error rate", () => {
    it("passes when error rate is below threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnErrorRate: 10 });
      expect(result.passed).toBe(true);
      expect(result.breaches).toHaveLength(0);
    });

    it("breaches when error rate exceeds threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnErrorRate: 3 });
      expect(result.passed).toBe(false);
      expect(result.breaches).toHaveLength(1);
      expect(result.breaches[0]!.metric).toBe("error_rate");
      expect(result.breaches[0]!.threshold).toBe(3);
      expect(result.breaches[0]!.actual).toBe(5); // 50/1000 * 100 = 5%
      expect(result.breaches[0]!.unit).toBe("%");
    });

    it("passes when error rate equals threshold exactly", () => {
      const result = evaluateThresholds(baseResults, { failOnErrorRate: 5 });
      expect(result.passed).toBe(true);
    });

    it("throws when error rate metric is missing", () => {
      expect(() => evaluateThresholds({}, { failOnErrorRate: 5 })).toThrow("Missing metric: error rate");
    });
  });

  describe("p99 latency", () => {
    it("passes when p99 is below threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnP99: 500 });
      expect(result.passed).toBe(true);
    });

    it("breaches when p99 exceeds threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnP99: 300 });
      expect(result.passed).toBe(false);
      expect(result.breaches[0]!.metric).toBe("p99");
      expect(result.breaches[0]!.actual).toBe(350);
      expect(result.breaches[0]!.unit).toBe("ms");
    });

    it("passes when p99 equals threshold exactly", () => {
      const result = evaluateThresholds(baseResults, { failOnP99: 350 });
      expect(result.passed).toBe(true);
    });

    it("throws when p99 metric is missing", () => {
      expect(() => evaluateThresholds({ succ: 100 }, { failOnP99: 500 })).toThrow("Missing metric: p99");
    });
  });

  describe("p95 latency", () => {
    it("passes when p95 is below threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnP95: 300 });
      expect(result.passed).toBe(true);
    });

    it("breaches when p95 exceeds threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnP95: 150 });
      expect(result.passed).toBe(false);
      expect(result.breaches[0]!.metric).toBe("p95");
      expect(result.breaches[0]!.actual).toBe(200);
      expect(result.breaches[0]!.unit).toBe("ms");
    });

    it("throws when p95 metric is missing", () => {
      expect(() => evaluateThresholds({ succ: 100 }, { failOnP95: 200 })).toThrow("Missing metric: p95");
    });
  });

  describe("avg_rt latency", () => {
    it("passes when avg_rt is below threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnAvgRt: 200 });
      expect(result.passed).toBe(true);
    });

    it("breaches when avg_rt exceeds threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnAvgRt: 100 });
      expect(result.passed).toBe(false);
      expect(result.breaches[0]!.metric).toBe("avg_rt");
      expect(result.breaches[0]!.actual).toBe(120.5);
      expect(result.breaches[0]!.unit).toBe("ms");
    });

    it("throws when avg_rt metric is missing", () => {
      expect(() => evaluateThresholds({ succ: 100 }, { failOnAvgRt: 200 })).toThrow("Missing metric: avg_rt");
    });
  });

  describe("throughput", () => {
    it("passes when throughput is above threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnThroughputBelow: 50 });
      expect(result.passed).toBe(true);
    });

    it("breaches when throughput is below threshold", () => {
      const result = evaluateThresholds(baseResults, { failOnThroughputBelow: 150 });
      expect(result.passed).toBe(false);
      expect(result.breaches[0]!.metric).toBe("throughput");
      expect(result.breaches[0]!.actual).toBe(100);
      expect(result.breaches[0]!.threshold).toBe(150);
      expect(result.breaches[0]!.unit).toBe("req/s");
    });

    it("passes when throughput equals threshold exactly", () => {
      const result = evaluateThresholds(baseResults, { failOnThroughputBelow: 100 });
      expect(result.passed).toBe(true);
    });

    it("throws when throughput metric is missing", () => {
      expect(() => evaluateThresholds({ succ: 100 }, { failOnThroughputBelow: 50 })).toThrow(
        "Missing metric: throughput"
      );
    });
  });

  describe("multiple thresholds", () => {
    it("reports all breaches when multiple thresholds are violated", () => {
      const config: ThresholdConfig = {
        failOnErrorRate: 3,
        failOnP99: 300,
        failOnThroughputBelow: 150,
      };
      const result = evaluateThresholds(baseResults, config);
      expect(result.passed).toBe(false);
      expect(result.breaches).toHaveLength(3);
      const metrics = result.breaches.map((b) => b.metric);
      expect(metrics).toContain("error_rate");
      expect(metrics).toContain("p99");
      expect(metrics).toContain("throughput");
    });

    it("passes when all thresholds are within limits", () => {
      const config: ThresholdConfig = {
        failOnErrorRate: 10,
        failOnP99: 500,
        failOnP95: 300,
        failOnAvgRt: 200,
        failOnThroughputBelow: 50,
      };
      const result = evaluateThresholds(baseResults, config);
      expect(result.passed).toBe(true);
      expect(result.breaches).toHaveLength(0);
    });

    it("returns passed=true with empty config", () => {
      const result = evaluateThresholds(baseResults, {});
      expect(result.passed).toBe(true);
      expect(result.breaches).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles zero success and zero fail as 0% error rate", () => {
      const results: TestResultsData = { succ: 0, fail: 0, throughput: 10, avg_rt: "50", p99_0: "100" };
      const result = evaluateThresholds(results, { failOnErrorRate: 5 });
      expect(result.passed).toBe(true);
    });

    it("handles 100% error rate", () => {
      const results: TestResultsData = { succ: 0, fail: 100, throughput: 10, avg_rt: "50", p99_0: "100" };
      const result = evaluateThresholds(results, { failOnErrorRate: 99 });
      expect(result.passed).toBe(false);
      expect(result.breaches[0]!.actual).toBe(100);
    });

    it("handles string numeric values in results", () => {
      const results: TestResultsData = {
        succ: 900,
        fail: 100,
        throughput: 50,
        avg_rt: "200",
        p99_0: "500",
        p95_0: "300",
      };
      const result = evaluateThresholds(results, { failOnP99: 400 });
      expect(result.passed).toBe(false);
      expect(result.breaches[0]!.actual).toBe(500);
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateBaselineRegression
// ---------------------------------------------------------------------------

describe("evaluateBaselineRegression", () => {
  const baseline: TestResultsData = {
    avg_rt: "100",
    p50_0: "80",
    p90_0: "150",
    p99_0: "300",
    throughput: 100,
    succ: 900,
    fail: 10,
  };

  it("returns no breaches when current is within threshold", () => {
    const current: TestResultsData = {
      avg_rt: "110",
      p50_0: "85",
      p90_0: "160",
      p99_0: "320",
      throughput: 95,
      succ: 890,
      fail: 11,
    };
    const breaches = evaluateBaselineRegression(current, baseline, 20);
    expect(breaches).toHaveLength(0);
  });

  it("detects latency regression when avg_rt increases beyond threshold", () => {
    const current: TestResultsData = {
      avg_rt: "130",
      p50_0: "80",
      p90_0: "150",
      p99_0: "300",
      throughput: 100,
      fail: 10,
    };
    const breaches = evaluateBaselineRegression(current, baseline, 20);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.metric).toBe("baseline_regression_avg_rt");
    expect(breaches[0]!.actual).toBe(30); // 30% regression
  });

  it("detects throughput regression when throughput drops below threshold", () => {
    const current: TestResultsData = {
      avg_rt: "100",
      p50_0: "80",
      p90_0: "150",
      p99_0: "300",
      throughput: 70,
      fail: 10,
    };
    const breaches = evaluateBaselineRegression(current, baseline, 20);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.metric).toBe("baseline_regression_throughput");
    expect(breaches[0]!.actual).toBe(30); // 30% decrease
  });

  it("detects error count regression when errors increase beyond threshold", () => {
    const current: TestResultsData = {
      avg_rt: "100",
      p50_0: "80",
      p90_0: "150",
      p99_0: "300",
      throughput: 100,
      fail: 15,
    };
    const breaches = evaluateBaselineRegression(current, baseline, 20);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.metric).toBe("baseline_regression_errors");
    expect(breaches[0]!.actual).toBe(50); // 50% increase
  });

  it("reports infinite regression when baseline had zero errors and current has errors", () => {
    const zeroErrorBaseline: TestResultsData = { ...baseline, fail: 0 };
    const current: TestResultsData = {
      avg_rt: "100",
      p50_0: "80",
      p90_0: "150",
      p99_0: "300",
      throughput: 100,
      fail: 5,
    };
    const breaches = evaluateBaselineRegression(current, zeroErrorBaseline, 20);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.metric).toBe("baseline_regression_errors");
    expect(breaches[0]!.actual).toBe(Infinity);
  });

  it("reports multiple breaches simultaneously", () => {
    const current: TestResultsData = {
      avg_rt: "200",
      p50_0: "160",
      p90_0: "300",
      p99_0: "600",
      throughput: 50,
      fail: 50,
    };
    const breaches = evaluateBaselineRegression(current, baseline, 10);
    expect(breaches.length).toBeGreaterThan(1);
    const metrics = breaches.map((b) => b.metric);
    expect(metrics).toContain("baseline_regression_avg_rt");
    expect(metrics).toContain("baseline_regression_throughput");
    expect(metrics).toContain("baseline_regression_errors");
  });

  it("skips metrics missing from current results", () => {
    const current: TestResultsData = { throughput: 100, fail: 10 };
    const breaches = evaluateBaselineRegression(current, baseline, 20);
    expect(breaches).toHaveLength(0);
  });

  it("skips metrics missing from baseline results", () => {
    const emptyBaseline: TestResultsData = {};
    const current: TestResultsData = {
      avg_rt: "200",
      p50_0: "160",
      p90_0: "300",
      p99_0: "600",
      throughput: 50,
      fail: 50,
    };
    const breaches = evaluateBaselineRegression(current, emptyBaseline, 10);
    expect(breaches).toHaveLength(0);
  });

  it("does not breach when all metrics are exactly at the threshold boundary", () => {
    // 20% threshold, baseline avg_rt = 100, max allowed = 120
    const current: TestResultsData = {
      avg_rt: "120",
      p50_0: "96",
      p90_0: "180",
      p99_0: "360",
      throughput: 80,
      fail: 12,
    };
    const breaches = evaluateBaselineRegression(current, baseline, 20);
    expect(breaches).toHaveLength(0);
  });
});
