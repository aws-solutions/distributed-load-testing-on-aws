// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { BaselineResponse, LabelMetrics } from "../types/testResults";
import { AggregateMetrics, BaselineComparison, ViewMode } from "../types/viewMode";
import { aggregateBaselineMetrics } from "./testResultsTransformers";

/**
 * Finds matching baseline data for a specific region and test label.
 * Handles both individual labels and aggregated Overall mode case.
 */
export function findMatchingBaselineData(
  region: string,
  testLabel: string,
  baseline: BaselineResponse | undefined,
  viewMode: ViewMode,
): LabelMetrics | AggregateMetrics | null {
  if (!baseline?.testRunDetails?.results) {
    return null;
  }

  // Handle Overall mode - aggregate all labels
  if (viewMode === ViewMode.Overall && region === "total") {
    const baselineTotal = baseline.testRunDetails.results["total"];
    if (!baselineTotal) return null;
    
    const testDuration = parseFloat(baselineTotal.testDuration);
    return aggregateBaselineMetrics(baselineTotal, testDuration);
  }

  // Handle individual label lookup
  const baselineRegionData = baseline.testRunDetails.results[region];
  if (!baselineRegionData?.labels) {
    return null;
  }

  return baselineRegionData.labels.find((label) => label.label === testLabel) || null;
}

/**
 * Calculates baseline comparison for a single metric.
 * Returns percentage change: ((current - baseline) / baseline) * 100
 */
export function calculateMetricDelta(
  currentValue: number | undefined,
  baselineValue: number | undefined
): { delta: number; deltaText: string } | null {
  if (baselineValue === undefined || currentValue === undefined) {
    return null;
  }

  if (baselineValue === 0) {
    // Avoid division by zero
    return null;
  }

  const delta = ((currentValue - baselineValue) / baselineValue) * 100;
  const deltaText = `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`;

  return { delta, deltaText };
}

/**
 * Calculates all baseline comparisons for a given row.
 */
export function calculateBaselineComparison(
  currentRow: {
    requests: number;
    success: number;
    successRate: number;
    avgRespTime: number;
    p95RespTime: number;
    errors: number;
    requestsPerSecond: number;
    avgLatency: number;
    avgConnectionTime: number;
    avgBandwidth: number;
    p0RespTime: number;
    p50RespTime: number;
    p90RespTime: number;
    p99RespTime: number;
    p99_9RespTime: number;
    p100RespTime: number;
  },
  baselineData: LabelMetrics | AggregateMetrics | null
): BaselineComparison | undefined {
  if (!baselineData) {
    return undefined;
  }

  // Extract baseline values - handle both LabelMetrics and AggregateMetrics
  if ("throughput" in baselineData) {
    // LabelMetrics
    const testDuration = parseFloat(baselineData.testDuration) || 0;
    const bytes = parseFloat(baselineData.bytes) || 0;
    
    return {
      requests: baselineData.throughput,
      success: baselineData.succ,
      successRate: baselineData.throughput > 0 ? (baselineData.succ / baselineData.throughput) * 100 : 0,
      avgRespTime: parseFloat(baselineData.avg_rt) * 1000,
      p95RespTime: parseFloat(baselineData.p95_0) * 1000,
      errors: baselineData.fail,
      requestsPerSecond: testDuration > 0 ? baselineData.throughput / testDuration : 0,
      avgLatency: parseFloat(baselineData.avg_lt) * 1000,
      avgConnectionTime: parseFloat(baselineData.avg_ct) * 1000,
      avgBandwidth: testDuration > 0 ? (bytes / testDuration) / 1024 : 0,
      p0RespTime: parseFloat(baselineData.p0_0) * 1000,
      p50RespTime: parseFloat(baselineData.p50_0) * 1000,
      p90RespTime: parseFloat(baselineData.p90_0) * 1000,
      p99RespTime: parseFloat(baselineData.p99_0) * 1000,
      p99_9RespTime: parseFloat(baselineData.p99_9) * 1000,
      p100RespTime: parseFloat(baselineData.p100_0) * 1000,
    };
  } else {
    // AggregateMetrics
    return {
      requests: baselineData.requests,
      success: baselineData.success,
      successRate: baselineData.successRate,
      avgRespTime: baselineData.avgRespTime,
      p95RespTime: baselineData.p95RespTime,
      errors: baselineData.errors,
      requestsPerSecond: baselineData.requestsPerSecond,
      avgLatency: baselineData.avgLatency,
      avgConnectionTime: baselineData.avgConnectionTime,
      avgBandwidth: baselineData.avgBandwidth,
      p0RespTime: baselineData.p0RespTime,
      p50RespTime: baselineData.p50RespTime,
      p90RespTime: baselineData.p90RespTime,
      p99RespTime: baselineData.p99RespTime,
      p99_9RespTime: baselineData.p99_9RespTime,
      p100RespTime: baselineData.p100RespTime,
    };
  }
}

/**
 * Calculates aggregated baseline totals for header display.
 */
export function calculateAggregatedBaseline(
  baseline: BaselineResponse | undefined
): AggregateMetrics | null {
  if (!baseline?.testRunDetails?.results?.total) {
    return null;
  }

  const baselineTotal = baseline.testRunDetails.results.total;
  const testDuration = parseFloat(baselineTotal.testDuration);
  return aggregateBaselineMetrics(baselineTotal, testDuration);
}
