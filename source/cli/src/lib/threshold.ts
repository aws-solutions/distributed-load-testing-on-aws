// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TestResultsData } from "./types.js";

// ---------------------------------------------------------------------------
// Threshold evaluation for CI/CD pipeline gates
// ---------------------------------------------------------------------------

/** Configuration for threshold-based pass/fail gates. */
export interface ThresholdConfig {
  failOnErrorRate?: number; // 0-100 (percentage)
  failOnP99?: number; // milliseconds, > 0
  failOnP95?: number; // milliseconds, > 0
  failOnAvgRt?: number; // milliseconds, > 0
  failOnThroughputBelow?: number; // requests/sec, > 0
  failOnBaselineRegression?: number; // percentage, > 0
}

/** Result of evaluating thresholds against test results. */
export interface ThresholdResult {
  passed: boolean;
  breaches: ThresholdBreach[];
}

/** A single threshold breach with metric details. */
export interface ThresholdBreach {
  metric: string;
  threshold: number;
  actual: number;
  unit: string;
}

/**
 * Parse threshold flags from CLI options into a validated ThresholdConfig.
 * Throws descriptive errors for invalid values.
 */
export function parseThresholdFlags(options: Record<string, string | undefined>): ThresholdConfig {
  const config: ThresholdConfig = {};

  if (options["failOnErrorRate"] !== undefined) {
    const val = parseNumeric(options["failOnErrorRate"], "failOnErrorRate");
    if (val < 0 || val > 100) {
      throw new Error("Invalid threshold: --fail-on-error-rate must be between 0 and 100 (inclusive)");
    }
    config.failOnErrorRate = val;
  }

  if (options["failOnP99"] !== undefined) {
    const val = parseNumeric(options["failOnP99"], "failOnP99");
    if (val <= 0) {
      throw new Error("Invalid threshold: --fail-on-p99 must be greater than 0");
    }
    config.failOnP99 = val;
  }

  if (options["failOnP95"] !== undefined) {
    const val = parseNumeric(options["failOnP95"], "failOnP95");
    if (val <= 0) {
      throw new Error("Invalid threshold: --fail-on-p95 must be greater than 0");
    }
    config.failOnP95 = val;
  }

  if (options["failOnAvgRt"] !== undefined) {
    const val = parseNumeric(options["failOnAvgRt"], "failOnAvgRt");
    if (val <= 0) {
      throw new Error("Invalid threshold: --fail-on-avg-rt must be greater than 0");
    }
    config.failOnAvgRt = val;
  }

  if (options["failOnThroughputBelow"] !== undefined) {
    const val = parseNumeric(options["failOnThroughputBelow"], "failOnThroughputBelow");
    if (val <= 0) {
      throw new Error("Invalid threshold: --fail-on-throughput-below must be greater than 0");
    }
    config.failOnThroughputBelow = val;
  }

  if (options["failOnBaselineRegression"] !== undefined) {
    const val = parseNumeric(options["failOnBaselineRegression"], "failOnBaselineRegression");
    if (val <= 0) {
      throw new Error("Invalid threshold: --fail-on-baseline-regression must be greater than 0");
    }
    config.failOnBaselineRegression = val;
  }

  return config;
}

/**
 * Evaluate thresholds against test results and return pass/fail with breach details.
 *
 * Breach conditions:
 * - Error rate: actual > threshold
 * - Latency (p99, p95, avg_rt): actual > threshold
 * - Throughput: actual < threshold (minimum gate)
 */
export function evaluateThresholds(results: TestResultsData, config: ThresholdConfig): ThresholdResult {
  const breaches: ThresholdBreach[] = [];

  if (config.failOnErrorRate !== undefined) {
    const errorRate = computeErrorRate(results);
    if (errorRate === undefined) {
      throw new Error("Missing metric: error rate data not available in test results");
    }
    if (errorRate > config.failOnErrorRate) {
      breaches.push({ metric: "error_rate", threshold: config.failOnErrorRate, actual: errorRate, unit: "%" });
    }
  }

  if (config.failOnP99 !== undefined) {
    const p99 = parseMetric(results["p99_0"]);
    if (p99 === undefined) {
      throw new Error("Missing metric: p99 latency data not available in test results");
    }
    if (p99 > config.failOnP99) {
      breaches.push({ metric: "p99", threshold: config.failOnP99, actual: p99, unit: "ms" });
    }
  }

  if (config.failOnP95 !== undefined) {
    const p95 = parseMetric(results["p95_0"]);
    if (p95 === undefined) {
      throw new Error("Missing metric: p95 latency data not available in test results");
    }
    if (p95 > config.failOnP95) {
      breaches.push({ metric: "p95", threshold: config.failOnP95, actual: p95, unit: "ms" });
    }
  }

  if (config.failOnAvgRt !== undefined) {
    const avgRt = parseMetric(results["avg_rt"]);
    if (avgRt === undefined) {
      throw new Error("Missing metric: avg_rt data not available in test results");
    }
    if (avgRt > config.failOnAvgRt) {
      breaches.push({ metric: "avg_rt", threshold: config.failOnAvgRt, actual: avgRt, unit: "ms" });
    }
  }

  if (config.failOnThroughputBelow !== undefined) {
    const throughput = parseMetric(results["throughput"]);
    if (throughput === undefined) {
      throw new Error("Missing metric: throughput data not available in test results");
    }
    if (throughput < config.failOnThroughputBelow) {
      breaches.push({
        metric: "throughput",
        threshold: config.failOnThroughputBelow,
        actual: throughput,
        unit: "req/s",
      });
    }
  }

  return { passed: breaches.length === 0, breaches };
}

/**
 * Evaluate baseline regression by comparing current results against baseline results.
 * Returns breaches if any metric regresses beyond the threshold percentage.
 *
 * Metrics compared:
 * - Latency (avg_rt, p50, p90, p99): breach if current > baseline * (1 + threshold/100)
 * - Throughput: breach if current < baseline * (1 - threshold/100)
 * - Error count: breach if current > baseline * (1 + threshold/100)
 */
export function evaluateBaselineRegression(
  current: TestResultsData,
  baseline: TestResultsData,
  thresholdPercent: number
): ThresholdBreach[] {
  const breaches: ThresholdBreach[] = [];
  const factor = thresholdPercent / 100;

  // Latency metrics — breach if current is higher than baseline by more than threshold %
  const latencyMetrics: Array<{ key: string; label: string }> = [
    { key: "avg_rt", label: "avg_rt" },
    { key: "p50_0", label: "p50" },
    { key: "p90_0", label: "p90" },
    { key: "p95_0", label: "p95" },
    { key: "p99_0", label: "p99" },
  ];

  for (const { key, label } of latencyMetrics) {
    const currentVal = parseMetric(current[key]);
    const baselineVal = parseMetric(baseline[key]);
    if (currentVal !== undefined && baselineVal !== undefined && baselineVal > 0) {
      const maxAllowed = baselineVal * (1 + factor);
      if (currentVal > maxAllowed) {
        const regressionPct = ((currentVal - baselineVal) / baselineVal) * 100;
        breaches.push({
          metric: `baseline_regression_${label}`,
          threshold: thresholdPercent,
          actual: Math.round(regressionPct * 100) / 100,
          unit: "% regression",
        });
      }
    }
  }

  // Throughput — breach if current is lower than baseline by more than threshold %
  const currentThroughput = parseMetric(current["throughput"]);
  const baselineThroughput = parseMetric(baseline["throughput"]);
  if (currentThroughput !== undefined && baselineThroughput !== undefined && baselineThroughput > 0) {
    const minAllowed = baselineThroughput * (1 - factor);
    if (currentThroughput < minAllowed) {
      const regressionPct = ((baselineThroughput - currentThroughput) / baselineThroughput) * 100;
      breaches.push({
        metric: "baseline_regression_throughput",
        threshold: thresholdPercent,
        actual: Math.round(regressionPct * 100) / 100,
        unit: "% regression",
      });
    }
  }

  // Error count — breach if current errors exceed baseline by more than threshold %
  const currentFail = current["fail"] !== undefined ? Number(current["fail"]) : undefined;
  const baselineFail = baseline["fail"] !== undefined ? Number(baseline["fail"]) : undefined;
  if (
    currentFail !== undefined &&
    baselineFail !== undefined &&
    !Number.isNaN(currentFail) &&
    !Number.isNaN(baselineFail)
  ) {
    if (baselineFail > 0) {
      const maxAllowed = baselineFail * (1 + factor);
      if (currentFail > maxAllowed) {
        const regressionPct = ((currentFail - baselineFail) / baselineFail) * 100;
        breaches.push({
          metric: "baseline_regression_errors",
          threshold: thresholdPercent,
          actual: Math.round(regressionPct * 100) / 100,
          unit: "% regression",
        });
      }
    } else if (currentFail > 0) {
      // Baseline had zero errors but current has errors — infinite regression
      breaches.push({
        metric: "baseline_regression_errors",
        threshold: thresholdPercent,
        actual: Infinity,
        unit: "% regression",
      });
    }
  }

  return breaches;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumeric(value: string | undefined, flagName: string): number {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Invalid threshold: --${camelToKebab(flagName)} value is required`);
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`Invalid threshold: --${camelToKebab(flagName)} must be a numeric value, got "${value}"`);
  }
  return num;
}

function parseMetric(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

function computeErrorRate(results: TestResultsData): number | undefined {
  const succ = parseMetric(results["succ"]);
  const fail = parseMetric(results["fail"]);
  if (succ === undefined && fail === undefined) return undefined;
  const total = (succ ?? 0) + (fail ?? 0);
  if (total === 0) return 0;
  return ((fail ?? 0) / total) * 100;
}

function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}
