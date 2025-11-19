// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { LabelMetrics, TableRow, TestResults, TestRunDetails } from "../types/testResults";
import { AggregateMetrics, ViewMode } from "../types/viewMode";

/**
 * Aggregates all endpoint metrics into a single combined metric set, used to visualize the Overall tab.
 * Uses weighted averages for response times based on request count.
 */
export function aggregateEndpoints(labels: LabelMetrics[], testDuration: number): AggregateMetrics {
  if (!labels || labels.length === 0) {
    return {
      requests: 0,
      success: 0,
      successRate: 0,
      avgRespTime: 0,
      p95RespTime: 0,
      errors: 0,
      requestsPerSecond: 0,
      avgLatency: 0,
      avgConnectionTime: 0,
      avgBandwidth: 0,
      p0RespTime: 0,
      p50RespTime: 0,
      p90RespTime: 0,
      p99RespTime: 0,
      p99_9RespTime: 0,
      p100RespTime: 0,
    };
  }

  let totalRequests = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let totalBytes = 0;
  // let totalDuration = 0;
  let weightedAvgRespTime = 0;
  let weightedAvgLatency = 0;
  let weightedAvgConnectionTime = 0;
  let weightedP0RespTime = 0;
  let weightedP50RespTime = 0;
  let weightedP90RespTime = 0;
  let weightedP95RespTime = 0;
  let weightedP99RespTime = 0;
  let weightedP99_9RespTime = 0;
  let weightedP100RespTime = 0;

  labels.forEach((label) => {
    totalRequests += label.throughput;
    totalSuccess += label.succ;
    totalErrors += label.fail;
    totalBytes += parseFloat(label.bytes) || 0;
    // totalDuration += parseFloat(label.testDuration) || 0;

    // Weighted by request count for accurate averaging
    weightedAvgRespTime += parseFloat(label.avg_rt) * 1000 * label.throughput;
    weightedAvgLatency += parseFloat(label.avg_lt) * 1000 * label.throughput;
    weightedAvgConnectionTime += parseFloat(label.avg_ct) * 1000 * label.throughput;
    weightedP0RespTime += parseFloat(label.p0_0) * 1000 * label.throughput;
    weightedP50RespTime += parseFloat(label.p50_0) * 1000 * label.throughput;
    weightedP90RespTime += parseFloat(label.p90_0) * 1000 * label.throughput;
    weightedP95RespTime += parseFloat(label.p95_0) * 1000 * label.throughput;
    weightedP99RespTime += parseFloat(label.p99_0) * 1000 * label.throughput;
    weightedP99_9RespTime += parseFloat(label.p99_9) * 1000 * label.throughput;
    weightedP100RespTime += parseFloat(label.p100_0) * 1000 * label.throughput;
  });

  // Calculate weighted averages
  const avgRespTime = totalRequests > 0 ? weightedAvgRespTime / totalRequests : 0;
  const avgLatency = totalRequests > 0 ? weightedAvgLatency / totalRequests : 0;
  const avgConnectionTime = totalRequests > 0 ? weightedAvgConnectionTime / totalRequests : 0;
  const p0RespTime = totalRequests > 0 ? weightedP0RespTime / totalRequests : 0;
  const p50RespTime = totalRequests > 0 ? weightedP50RespTime / totalRequests : 0;
  const p90RespTime = totalRequests > 0 ? weightedP90RespTime / totalRequests : 0;
  const p95RespTime = totalRequests > 0 ? weightedP95RespTime / totalRequests : 0;
  const p99RespTime = totalRequests > 0 ? weightedP99RespTime / totalRequests : 0;
  const p99_9RespTime = totalRequests > 0 ? weightedP99_9RespTime / totalRequests : 0;
  const p100RespTime = totalRequests > 0 ? weightedP100RespTime / totalRequests : 0;
  const successRate = totalRequests > 0 ? (totalSuccess / totalRequests) * 100 : 0;

  // Calculate derived metrics
  const requestsPerSecond = testDuration > 0 ? totalRequests / testDuration : 0;
  const avgBandwidth = testDuration > 0 ? (totalBytes / testDuration) / 1024 : 0; // KB/s

  return {
    requests: totalRequests,
    success: totalSuccess,
    successRate,
    avgRespTime,
    p95RespTime,
    errors: totalErrors,
    requestsPerSecond,
    avgLatency,
    avgConnectionTime,
    avgBandwidth,
    p0RespTime,
    p50RespTime,
    p90RespTime,
    p99RespTime,
    p99_9RespTime,
    p100RespTime,
  };
}

/**
 * Aggregates baseline metrics using the same formula as current data.
 */
export function aggregateBaselineMetrics(baselineTotal: TestResults, testDuration: number): AggregateMetrics | null {
  if (!baselineTotal?.labels || baselineTotal.labels.length === 0) {
    return null;
  }

  return aggregateEndpoints(baselineTotal.labels, testDuration);
}

/**
 * Transforms test run data to table rows based on view mode.
 */
export function transformToTableRows(
  testRun: TestRunDetails,
  viewMode: ViewMode
): TableRow[] {
  if (!testRun?.results) {
    return [];
  }

  switch (viewMode) {
    case ViewMode.Overall:
      return transformToOverall(testRun);
    case ViewMode.ByEndpoint:
      return transformToByEndpoint(testRun);
    case ViewMode.ByRegion:
      return transformToByRegion(testRun);
  }
}

/**
 * Creates a single aggregated row combining all endpoints.
 */
function transformToOverall(testRun: TestRunDetails): TableRow[] {
  const totalData = testRun.results["total"];
  if (!totalData?.labels || totalData.labels.length === 0) {
    return [];
  }

  const testDuration = parseFloat(totalData.testDuration);
  const aggregated = aggregateEndpoints(totalData.labels, testDuration);

  return [
    {
      id: "overall-aggregate",
      run: new Date(testRun.startTime).toLocaleString(),
      region: "total",
      testLabel: "--",
      requests: aggregated.requests,
      success: aggregated.success,
      successRate: aggregated.successRate,
      avgRespTime: aggregated.avgRespTime,
      p95RespTime: aggregated.p95RespTime,
      errors: aggregated.errors,
      requestsPerSecond: aggregated.requestsPerSecond,
      avgLatency: aggregated.avgLatency,
      avgConnectionTime: aggregated.avgConnectionTime,
      avgBandwidth: aggregated.avgBandwidth,
      p0RespTime: aggregated.p0RespTime,
      p50RespTime: aggregated.p50RespTime,
      p90RespTime: aggregated.p90RespTime,
      p99RespTime: aggregated.p99RespTime,
      p99_9RespTime: aggregated.p99_9RespTime,
      p100RespTime: aggregated.p100RespTime,
    },
  ];
}

/**
 * Shows one row per endpoint from "total" region.
 */
function transformToByEndpoint(testRun: TestRunDetails): TableRow[] {
  const tableData: TableRow[] = [];
  const totalData = testRun.results["total"];

  if (!totalData?.labels) {
    return tableData;
  }

  totalData.labels.forEach((label, labelIndex) => {
    const testDuration = parseFloat(label.testDuration) || 0;
    const bytes = parseFloat(label.bytes) || 0;
    
    tableData.push({
      id: `total-${label.label}-${labelIndex}`,
      run: new Date(testRun.startTime).toLocaleString(),
      region: "total",
      testLabel: label.label,
      requests: label.throughput,
      success: label.succ,
      successRate: label.throughput > 0 ? (label.succ / label.throughput) * 100 : 0,
      avgRespTime: parseFloat(label.avg_rt) * 1000,
      p95RespTime: parseFloat(label.p95_0) * 1000,
      errors: label.fail,
      requestsPerSecond: testDuration > 0 ? label.throughput / testDuration : 0,
      avgLatency: parseFloat(label.avg_lt) * 1000,
      avgConnectionTime: parseFloat(label.avg_ct) * 1000,
      avgBandwidth: testDuration > 0 ? (bytes / testDuration) / 1024 : 0,
      p0RespTime: parseFloat(label.p0_0) * 1000,
      p50RespTime: parseFloat(label.p50_0) * 1000,
      p90RespTime: parseFloat(label.p90_0) * 1000,
      p99RespTime: parseFloat(label.p99_0) * 1000,
      p99_9RespTime: parseFloat(label.p99_9) * 1000,
      p100RespTime: parseFloat(label.p100_0) * 1000,
    });
  });

  return tableData;
}

/**
 * Shows breakdown by region (excludes "total").
 */
function transformToByRegion(testRun: TestRunDetails): TableRow[] {
  const tableData: TableRow[] = [];

  Object.entries(testRun.results).forEach(([regionKey, regionData]) => {
    // Skip the "total" region
    if (regionKey === "total") {
      return;
    }

    regionData.labels?.forEach((label, labelIndex) => {
      const testDuration = parseFloat(label.testDuration) || 0;
      const bytes = parseFloat(label.bytes) || 0;
      
      tableData.push({
        id: `${regionKey}-${label.label}-${labelIndex}`,
        run: new Date(testRun.startTime).toLocaleString(),
        region: regionKey,
        testLabel: label.label,
        requests: label.throughput,
        success: label.succ,
        successRate: label.throughput > 0 ? (label.succ / label.throughput) * 100 : 0,
        avgRespTime: parseFloat(label.avg_rt) * 1000,
        p95RespTime: parseFloat(label.p95_0) * 1000,
        errors: label.fail,
        requestsPerSecond: testDuration > 0 ? label.throughput / testDuration : 0,
        avgLatency: parseFloat(label.avg_lt) * 1000,
        avgConnectionTime: parseFloat(label.avg_ct) * 1000,
        avgBandwidth: testDuration > 0 ? (bytes / testDuration) / 1024 : 0,
        p0RespTime: parseFloat(label.p0_0) * 1000,
        p50RespTime: parseFloat(label.p50_0) * 1000,
        p90RespTime: parseFloat(label.p90_0) * 1000,
        p99RespTime: parseFloat(label.p99_0) * 1000,
        p99_9RespTime: parseFloat(label.p99_9) * 1000,
        p100RespTime: parseFloat(label.p100_0) * 1000,
      });
    });
  });

  return tableData;
}
