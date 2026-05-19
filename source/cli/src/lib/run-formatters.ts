// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TestRun, BaselineResponse } from "./types.js";
import { colorStatus, colorErrors, colorDelta, markAsBaseline, type MetricDirection } from "./color.js";

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

/**
 * Append " UTC" to a timestamp string for display, unless it already
 * contains timezone information (Z, +/-offset, or UTC).
 */
export function formatTimestamp(ts: string): string {
  if (!ts) return "";
  if (/[+-]\d{2}:\d{2}$/.test(ts) || /Z$/i.test(ts) || /UTC/i.test(ts)) return ts;
  return `${ts} UTC`;
}

// ---------------------------------------------------------------------------
// Active-status helpers
// ---------------------------------------------------------------------------

export const ACTIVE_STATUSES = new Set(["running", "pending", "provisioning"]);

/**
 *
 * @param status
 */
export function isActive(status: string | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status.toLowerCase());
}

// ---------------------------------------------------------------------------
// Table-row formatting
// ---------------------------------------------------------------------------

/**
 * Flatten a TestRun into a clean row for table display,
 * extracting key metrics and percentiles as top-level columns.
 *
 * Handles two API response shapes:
 * - List API:   flat fields like `requests`, `avgResponseTime`, `percentiles.p50`
 * - Single API: nested `results.total` with `avg_rt`, `p50_0`, `succ`, etc.
 *
 * @param r
 */
export function curateRunRow(r: TestRun): Record<string, unknown> {
  const raw = r as Record<string, unknown>;

  // Try flat fields first (from list / latest endpoints)
  let requests = raw["requests"];
  let success = raw["success"];
  let errors = raw["errors"];
  let avgResponseTime = raw["avgResponseTime"];
  const pct = (raw["percentiles"] ?? {}) as Record<string, unknown>;
  let p50 = pct["p50"];
  let p90 = pct["p90"];
  let p99 = pct["p99"];

  // Fall back to nested results.total (from single-run GET endpoint)
  if (requests === undefined || requests === null) {
    const results = (raw["results"] ?? {}) as Record<string, unknown>;
    const total = (results["total"] ?? {}) as Record<string, unknown>;
    if (total["avg_rt"] !== undefined) {
      // results.total has string values in seconds — convert to ms for display
      const toMs = (v: unknown): string | number => {
        if (v === undefined || v === null) return "";
        const n = parseFloat(String(v));
        return isNaN(n) ? "" : parseFloat((n * 1000).toFixed(2));
      };
      requests = total["succ"] ?? raw["succPercent"] ?? "";
      success = total["succ"] ?? raw["succPercent"] ?? "";
      errors = total["fail"] ?? 0;
      avgResponseTime = toMs(total["avg_rt"]);
      p50 = toMs(total["p50_0"]);
      p90 = toMs(total["p90_0"]);
      p99 = toMs(total["p99_0"]);
    }
  }

  return {
    testRunId: r.testRunId,
    status: r.status,
    startTime: formatTimestamp(r.startTime ?? ""),
    endTime: formatTimestamp(r.endTime ?? ""),
    requests: requests ?? "",
    success: success ?? "",
    errors: errors ?? "",
    avgResponseTime: avgResponseTime ?? "",
    p50: p50 ?? "",
    p90: p90 ?? "",
    p99: p99 ?? "",
  };
}

// ---------------------------------------------------------------------------
// Baseline comparison helpers
// ---------------------------------------------------------------------------

/** Aggregate metrics extracted from the baseline run for comparison. */
export interface BaselineMetrics {
  baselineRunId: string;
  requests: number;
  success: number;
  errors: number;
  avgResponseTime: number;
  requestsPerSecond: number;
  p50: number;
  p90: number;
  p99: number;
}

/**
 * Extract aggregate baseline metrics from a BaselineResponse.
 * Returns null when there is no baseline or no results.
 */
export function extractBaselineMetrics(baseline: BaselineResponse): BaselineMetrics | null {
  if (!baseline.baselineId || !baseline.testRunDetails?.results) {
    return null;
  }

  const total = baseline.testRunDetails.results["total"];
  if (!total) return null;

  const duration = parseFloat(String(total.testDuration ?? "0")) || 0;
  const throughput = total.throughput ?? 0;
  const succ = total.succ ?? 0;
  const fail = total.fail ?? 0;

  const toMs = (v: unknown): number => {
    if (v === undefined || v === null) return 0;
    const n = parseFloat(String(v));
    return isNaN(n) ? 0 : parseFloat((n * 1000).toFixed(2));
  };

  return {
    baselineRunId: baseline.testRunDetails.testRunId,
    requests: throughput,
    success: succ,
    errors: fail,
    avgResponseTime: toMs(total.avg_rt),
    requestsPerSecond: duration > 0 ? parseFloat((throughput / duration).toFixed(2)) : 0,
    p50: toMs(total.p50_0),
    p90: toMs(total.p90_0),
    p99: toMs(total.p99_0),
  };
}

/**
 * Compute the percentage delta between a current value and a baseline value.
 * Returns null when comparison is not possible (missing values or zero baseline).
 */
export function computeBaselineDelta(
  current: number | undefined,
  baseline: number | undefined
): { delta: number; deltaText: string } | null {
  if (current === undefined || current === null || baseline === undefined || baseline === null) {
    return null;
  }
  if (baseline === 0) {
    if (current === 0) return { delta: 0, deltaText: "0.0%" };
    return null;
  }
  const delta = ((current - baseline) / baseline) * 100;
  const sign = delta > 0 ? "+" : "";
  return { delta, deltaText: `${sign}${delta.toFixed(1)}%` };
}

/**
 * Build a table row with interleaved baseline delta columns.
 * Each metric column is followed by its "Δ baseline" column.
 */
export function curateRunRowWithBaseline(r: TestRun, bm: BaselineMetrics): Record<string, unknown> {
  const base = curateRunRow(r);

  const num = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  };

  const delta = (field: string, baselineVal: number): string => {
    const d = computeBaselineDelta(num(base[field]), baselineVal);
    return d ? d.deltaText : "--";
  };

  return {
    testRunId: base["testRunId"],
    status: base["status"],
    startTime: base["startTime"],
    endTime: base["endTime"],
    requests: base["requests"],
    [`Δ requests (${bm.requests.toLocaleString("en-US")})`]: delta("requests", bm.requests),
    success: base["success"],
    [`Δ success (${bm.success.toLocaleString("en-US")})`]: delta("success", bm.success),
    errors: base["errors"],
    avgResponseTime: base["avgResponseTime"],
    [`Δ avgRespTime (${bm.avgResponseTime}ms)`]: delta("avgResponseTime", bm.avgResponseTime),
    p50: base["p50"],
    p90: base["p90"],
    p99: base["p99"],
  };
}

// ---------------------------------------------------------------------------
// Colored table row variants
// ---------------------------------------------------------------------------

/** Mapping from delta column field name prefix to its semantic direction. */
const DELTA_DIRECTIONS: Record<string, MetricDirection> = {
  requests: "throughput",
  success: "throughput",
  errors: "errors",
  avgResponseTime: "latency",
  avgRespTime: "latency",
  p50: "latency",
  p90: "latency",
  p99: "latency",
};

/**
 * Apply semantic colors to a curated run row for table display.
 * Colors: status, errors. Does NOT mutate the input.
 */
export function colorRunRow(row: Record<string, unknown>): Record<string, unknown> {
  const colored = { ...row };
  if (typeof colored["status"] === "string") {
    colored["status"] = colorStatus(colored["status"]);
  }
  if (colored["errors"] !== undefined && colored["errors"] !== "") {
    colored["errors"] = colorErrors(colored["errors"]);
  }
  return colored;
}

/**
 * Apply semantic colors to a baseline-comparison table row.
 * Colors: status, errors, and all delta columns with metric-aware direction.
 * When baselineRunId is provided and matches the row's testRunId, appends a "◆ baseline" marker.
 */
export function colorBaselineRow(row: Record<string, unknown>, baselineRunId?: string): Record<string, unknown> {
  const colored = colorRunRow(row);

  // Mark the baseline run itself
  if (baselineRunId && colored["testRunId"] === baselineRunId) {
    colored["testRunId"] = markAsBaseline(String(colored["testRunId"]));
  }

  for (const key of Object.keys(colored)) {
    if (!key.startsWith("Δ ")) continue;
    const val = colored[key];
    if (typeof val !== "string") continue;

    // Determine metric direction from the delta column key
    // Keys look like: "Δ requests (3,811)" or "Δ avgRespTime (250ms)"
    const metricPart = key.slice(2).split("(")[0]!.trim();
    const direction = DELTA_DIRECTIONS[metricPart] ?? "throughput";
    colored[key] = colorDelta(val, direction);
  }

  return colored;
}

/** Metric-level delta for JSON output. */
export interface MetricDelta {
  baselineValue: number;
  delta: string;
}

/**
 * Enrich a raw test run with baseline comparison data for JSON output.
 * Adds a `baseline` key with per-metric deltas.
 */
export function enrichRunWithBaseline(r: TestRun, bm: BaselineMetrics): Record<string, unknown> {
  const row = curateRunRow(r);

  const num = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  };

  const metricDelta = (field: string, baselineVal: number): MetricDelta | null => {
    const d = computeBaselineDelta(num(row[field]), baselineVal);
    if (!d) return null;
    return { baselineValue: baselineVal, delta: d.deltaText };
  };

  const baseline: Record<string, unknown> = {
    baselineRunId: bm.baselineRunId,
  };

  const fields: Array<{ key: string; bVal: number }> = [
    { key: "requests", bVal: bm.requests },
    { key: "success", bVal: bm.success },
    { key: "errors", bVal: bm.errors },
    { key: "avgResponseTime", bVal: bm.avgResponseTime },
    { key: "p50", bVal: bm.p50 },
    { key: "p90", bVal: bm.p90 },
    { key: "p99", bVal: bm.p99 },
  ];

  for (const { key, bVal } of fields) {
    const md = metricDelta(key, bVal);
    baseline[key] = md ?? { baselineValue: bVal, delta: "--" };
  }

  // Spread the full raw run, then append the baseline comparison
  return { ...r, baseline };
}

// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------

/**
 *
 * @param ms
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
