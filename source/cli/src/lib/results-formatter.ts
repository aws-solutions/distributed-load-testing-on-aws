// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ApiClient } from "./api-client.js";
import { printResult } from "./output.js";
import type { OutputFormat, TestRun, TestRunsResponse, TestResultsData, FormattedTestResults } from "./types.js";
import { formatTimestamp } from "./run-formatters.js";
import { colorStatus, colorErrors } from "./color.js";

// ---------------------------------------------------------------------------
// Shared run/results metric formatting
//
// This module is the single source of truth for how a test run's metrics are
// presented. `runs get`, `runs latest`, and `scenarios results` all route
// through `curateRunResultRow` / `formatTestResults` so the same run renders
// with an identical column set regardless of entry point.
//
// Latency normalization (seconds → milliseconds) is centralized here so it is
// applied uniformly across the display formatters and the threshold gate.
// ---------------------------------------------------------------------------

/**
 * Latency metric keys stored in seconds in the nested (results.total) API format.
 * The flat (/testruns) format already reports these in milliseconds.
 */
export const LATENCY_KEYS_SECONDS = [
  "avg_rt",
  "avg_lt",
  "avg_ct",
  "p0_0",
  "p50_0",
  "p90_0",
  "p95_0",
  "p99_0",
  "p99_9",
  "p100_0",
  "stdev_rt",
];

/**
 * Extract the aggregate "total" results from a test run response object.
 * Handles two API response formats:
 * - Nested: run.results.total (from scenario detail endpoints), latency in seconds
 * - Flat: run has direct fields like success, errors, avgResponseTime (from /testruns list),
 *   latency already in milliseconds (flagged via `_unitsMs`)
 */
export function extractTotalResults(run: Record<string, unknown>): TestResultsData {
  // Try nested format first
  const results = run["results"] as Record<string, unknown> | undefined;
  if (results && typeof results === "object" && results["total"] && typeof results["total"] === "object") {
    return results["total"] as TestResultsData; // NOSONAR — TypeScript requires this cast from unknown
  }

  // Flat format: map API fields to the internal format expected by threshold evaluation.
  // Values from the /testruns endpoint are already in milliseconds.
  if (run["success"] !== undefined || run["errors"] !== undefined) {
    const percentiles = (run["percentiles"] ?? {}) as Record<string, unknown>;
    const data = {
      succ: run["success"],
      fail: run["errors"],
      avg_rt: run["avgResponseTime"],
      p50_0: percentiles["p50"],
      p90_0: percentiles["p90"],
      p95_0: percentiles["p95"],
      p99_0: percentiles["p99"],
      throughput: run["requestsPerSecond"],
      _unitsMs: true,
    } as TestResultsData;
    return data;
  }

  const empty: TestResultsData = {};
  return empty;
}

/**
 * Convert API metrics to a user-friendly FormattedTestResults object.
 * The nested format (results.total) stores latency in seconds.
 * The flat format (from /testruns) stores latency in milliseconds (_unitsMs flag).
 */
export function formatTestResults(total: TestResultsData): FormattedTestResults {
  const alreadyMs = (total as Record<string, unknown>)["_unitsMs"] === true;
  const toMs = (v: unknown): number => {
    if (v === undefined || v === null) return 0;
    let n: number;
    if (typeof v === "number") n = v;
    else if (typeof v === "string") n = Number.parseFloat(v);
    else return 0;
    if (Number.isNaN(n)) return 0;
    return alreadyMs ? Number.parseFloat(n.toFixed(2)) : Number.parseFloat((n * 1000).toFixed(2));
  };

  const toNum = (v: unknown): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      return Number.isNaN(n) ? 0 : n;
    }
    return 0;
  };

  const succ = toNum(total.succ);
  const fail = toNum(total.fail);
  const totalRequests = succ + fail;
  const errorRate = totalRequests > 0 ? Number.parseFloat(((fail / totalRequests) * 100).toFixed(2)) : 0;
  const throughput =
    typeof total.throughput === "number" ? total.throughput : Number.parseFloat(String(total.throughput ?? "0"));

  return {
    avgResponseTime: toMs(total.avg_rt),
    avgLatency: toMs(total["avg_lt"]),
    avgConnectionTime: toMs(total["avg_ct"]),
    p0: toMs(total["p0_0"]),
    p50: toMs(total.p50_0),
    p90: toMs(total.p90_0),
    p95: toMs(total["p95_0"]),
    p99: toMs(total.p99_0),
    p999: toMs(total["p99_9"]),
    p100: toMs(total["p100_0"]),
    stdDevResponseTime: toMs(total["stdev_rt"]),
    errorRate,
    successCount: succ,
    errorCount: fail,
    totalRequests,
    throughput: Number.parseFloat(throughput.toFixed(2)),
    testDuration: toNum(total.testDuration),
    bytesAvg: toNum(total["bytes"]),
  };
}

/** Parse a numeric value; returns Number.NaN for anything that isn't a number or numeric string. */
function toNumberOrNaN(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number.parseFloat(val);
  return Number.NaN;
}

/**
 * Normalize a results total to milliseconds so it can be compared against
 * ms-based thresholds. Flat (/testruns) data is already in ms and carries the
 * `_unitsMs` flag; nested (results.total) data stores latency in seconds and is
 * converted here. The returned object is flagged as ms so downstream baseline
 * normalization stays consistent.
 */
export function normalizeTotalToMs(total: TestResultsData): TestResultsData {
  if (total["_unitsMs"] === true) return total;

  const normalized: TestResultsData = { ...total };
  for (const key of LATENCY_KEYS_SECONDS) {
    // Latency values are numbers or numeric strings; ignore anything else.
    const n = toNumberOrNaN(normalized[key]);
    if (!Number.isNaN(n)) normalized[key] = n * 1000;
  }
  normalized["_unitsMs"] = true;
  return normalized;
}

/**
 * Build the canonical run row: run identity columns followed by the full
 * formatted metric set. This is the single shared shape used by `runs get`,
 * `runs latest`, and `scenarios results` so the same run renders identically
 * across table/json/csv output. Latency values are always in milliseconds.
 */
export function curateRunResultRow(run: TestRun): Record<string, unknown> {
  const total = extractTotalResults(run);
  const metrics = formatTestResults(total);
  return {
    testRunId: run.testRunId,
    status: run.status,
    startTime: formatTimestamp(run.startTime ?? ""),
    endTime: formatTimestamp(run.endTime ?? ""),
    ...metrics,
  };
}

/**
 * Apply semantic colors to a canonical run row for table display.
 * Colors: status, errorCount. Does NOT mutate the input.
 */
export function colorRunResultRow(row: Record<string, unknown>): Record<string, unknown> {
  const colored = { ...row };
  if (typeof colored["status"] === "string" && colored["status"] !== "") {
    colored["status"] = colorStatus(colored["status"]);
  }
  if (colored["errorCount"] !== undefined && colored["errorCount"] !== "") {
    colored["errorCount"] = colorErrors(colored["errorCount"]);
  }
  return colored;
}

/**
 * Fetch the most recent test run for a scenario, or undefined when it has none.
 *
 * `runs latest`, `scenarios results`, and `scenarios start --wait` all need the
 * single newest run; `limit=1&latest=true` returns it without pagination.
 * @param api The API client.
 * @param testId The scenario id.
 */
export async function fetchLatestRun(api: ApiClient, testId: string): Promise<TestRun | undefined> {
  const data = await api.get<TestRunsResponse>(`/scenarios/${encodeURIComponent(testId)}/testruns?limit=1&latest=true`);
  return data.testRuns?.[0];
}

/**
 * Print a single run through the canonical metric formatter.
 *
 * `table` shows the colored curated row, `csv` the plain curated row. `json`
 * emits `jsonValue` when supplied (the raw API object, for machine consumption)
 * and otherwise the curated row — the one behavioral difference between the
 * commands that share this renderer (`runs get`/`runs latest` emit raw JSON,
 * `scenarios results` emits the curated row).
 * @param run The run to render.
 * @param format The output format.
 * @param jsonValue Optional object to emit for `json` instead of the curated row.
 */
export function renderRun(run: TestRun, format: OutputFormat, jsonValue?: unknown): void {
  const row = curateRunResultRow(run);
  if (format === "table") {
    printResult(colorRunResultRow(row), { format: "table" });
  } else if (format === "csv") {
    printResult(row, { format: "csv" });
  } else {
    printResult(jsonValue ?? row, { format: "json" });
  }
}
