// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/output.js", () => ({ printResult: vi.fn() }));

import {
  LATENCY_KEYS_SECONDS,
  extractTotalResults,
  formatTestResults,
  normalizeTotalToMs,
  curateRunResultRow,
  colorRunResultRow,
  fetchLatestRun,
  renderRun,
} from "../../src/lib/results-formatter.js";
import { printResult } from "../../src/lib/output.js";
import { stripAnsi } from "../../src/lib/color.js";
import type { ApiClient } from "../../src/lib/api-client.js";
import type { TestRun } from "../../src/lib/types.js";

/**
 * The canonical column set that `runs get`, `runs latest`, and
 * `scenarios results` all present for a single run. Any change here is a
 * deliberate change to the unified output shape.
 */
const CANONICAL_COLUMNS = [
  "testRunId",
  "status",
  "startTime",
  "endTime",
  "avgResponseTime",
  "avgLatency",
  "avgConnectionTime",
  "p0",
  "p50",
  "p90",
  "p95",
  "p99",
  "p999",
  "p100",
  "stdDevResponseTime",
  "errorRate",
  "successCount",
  "errorCount",
  "totalRequests",
  "throughput",
  "testDuration",
  "bytesAvg",
];

describe("results-formatter", () => {
  describe("extractTotalResults", () => {
    it("extracts nested results.total when present", () => {
      const run = { testRunId: "r1", results: { total: { avg_rt: "0.25", succ: 900, fail: 100 } } };
      const total = extractTotalResults(run);
      expect(total.avg_rt).toBe("0.25");
      expect(total.succ).toBe(900);
      // Nested format is NOT flagged as ms (latency is in seconds)
      expect(total["_unitsMs"]).toBeUndefined();
    });

    it("maps flat /testruns fields and flags them as ms", () => {
      const run = {
        testRunId: "r2",
        success: 10000,
        errors: 5,
        avgResponseTime: 5.5,
        requestsPerSecond: 180,
        percentiles: { p50: 5, p90: 7, p95: 8, p99: 10 },
      };
      const total = extractTotalResults(run);
      expect(total.succ).toBe(10000);
      expect(total.fail).toBe(5);
      expect(total.avg_rt).toBe(5.5);
      expect(total.p99_0).toBe(10);
      expect(total.throughput).toBe(180);
      expect(total["_unitsMs"]).toBe(true);
    });

    it("returns an empty object when no metrics are recognizable", () => {
      const total = extractTotalResults({ testRunId: "r3", status: "running" });
      expect(total).toEqual({});
    });
  });

  describe("formatTestResults", () => {
    it("converts nested seconds-format latency to milliseconds", () => {
      const formatted = formatTestResults({
        avg_rt: "0.250",
        p50_0: "0.200",
        p95_0: "0.400",
        p99_0: "0.500",
        succ: 900,
        fail: 100,
        throughput: 50,
      });
      expect(formatted.avgResponseTime).toBe(250);
      expect(formatted.p50).toBe(200);
      expect(formatted.p95).toBe(400);
      expect(formatted.p99).toBe(500);
      expect(formatted.errorRate).toBe(10);
      expect(formatted.successCount).toBe(900);
      expect(formatted.errorCount).toBe(100);
      expect(formatted.totalRequests).toBe(1000);
      expect(formatted.throughput).toBe(50);
    });

    it("leaves flat ms-format latency unchanged (no double conversion)", () => {
      const formatted = formatTestResults({
        avg_rt: 5.5,
        p50_0: 5,
        p99_0: 10,
        succ: 100,
        fail: 0,
        throughput: 180,
        _unitsMs: true,
      });
      expect(formatted.avgResponseTime).toBe(5.5);
      expect(formatted.p50).toBe(5);
      expect(formatted.p99).toBe(10);
      expect(formatted.errorRate).toBe(0);
    });

    it("defaults missing metrics to zero", () => {
      const formatted = formatTestResults({});
      expect(formatted.totalRequests).toBe(0);
      expect(formatted.errorRate).toBe(0);
      expect(formatted.throughput).toBe(0);
      expect(formatted.avgResponseTime).toBe(0);
    });
  });

  describe("normalizeTotalToMs", () => {
    it("multiplies seconds-format latency keys by 1000 and flags as ms", () => {
      const normalized = normalizeTotalToMs({ avg_rt: "0.5", p99_0: "0.8", succ: 10 });
      expect(normalized.avg_rt).toBe(500);
      expect(normalized.p99_0).toBe(800);
      expect(normalized.succ).toBe(10);
      expect(normalized["_unitsMs"]).toBe(true);
    });

    it("is a no-op for data already flagged as ms", () => {
      const input = { avg_rt: 500, _unitsMs: true };
      expect(normalizeTotalToMs(input)).toBe(input);
    });

    it("covers every latency percentile key", () => {
      expect(LATENCY_KEYS_SECONDS).toContain("p95_0");
      expect(LATENCY_KEYS_SECONDS).toContain("p99_0");
      expect(LATENCY_KEYS_SECONDS).toContain("avg_rt");
    });
  });

  describe("curateRunResultRow", () => {
    it("produces the canonical column set (run identity + full metrics)", () => {
      const run: TestRun = {
        testRunId: "r1",
        status: "completed",
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-01T01:00:00Z",
        results: { total: { avg_rt: "0.250", p99_0: "0.500", succ: 900, fail: 100, throughput: 50 } },
      };
      const row = curateRunResultRow(run);
      expect(Object.keys(row)).toEqual(CANONICAL_COLUMNS);
      expect(row["testRunId"]).toBe("r1");
      expect(row["status"]).toBe("completed");
      expect(row["avgResponseTime"]).toBe(250);
      expect(row["p99"]).toBe(500);
    });

    it("presents an identical shape for the nested and flat API formats of the same run", () => {
      // Same logical run, two API shapes: nested seconds vs flat ms.
      const nested: TestRun = {
        testRunId: "r1",
        status: "completed",
        results: { total: { avg_rt: "0.005", p50_0: "0.005", p99_0: "0.010", succ: 100, fail: 0, throughput: 180 } },
      };
      const flat: TestRun = {
        testRunId: "r1",
        status: "completed",
        success: 100,
        errors: 0,
        avgResponseTime: 5,
        requestsPerSecond: 180,
        percentiles: { p50: 5, p99: 10 },
      };
      const nestedRow = curateRunResultRow(nested);
      const flatRow = curateRunResultRow(flat);

      // Same column set...
      expect(Object.keys(nestedRow)).toEqual(Object.keys(flatRow));
      // ...and the ms latency values match (seconds→ms normalization applied).
      expect(nestedRow["avgResponseTime"]).toBe(flatRow["avgResponseTime"]);
      expect(nestedRow["p50"]).toBe(flatRow["p50"]);
      expect(nestedRow["p99"]).toBe(flatRow["p99"]);
    });
  });

  describe("colorRunResultRow", () => {
    it("colors status and errorCount without mutating the input", () => {
      const row = curateRunResultRow({
        testRunId: "r1",
        status: "completed",
        results: { total: { succ: 90, fail: 10 } },
      } as TestRun);
      const original = { ...row };
      const colored = colorRunResultRow(row);

      expect(stripAnsi(String(colored["status"]))).toBe("completed");
      expect(stripAnsi(String(colored["errorCount"]))).toBe("10");
      // Input row is untouched
      expect(row).toEqual(original);
    });

    it("does not color a zero error count red", () => {
      const row = curateRunResultRow({
        testRunId: "r1",
        status: "completed",
        results: { total: { succ: 100, fail: 0 } },
      } as TestRun);
      const colored = colorRunResultRow(row);
      // colorErrors returns the plain string for a zero count
      expect(colored["errorCount"]).toBe("0");
    });
  });

  describe("fetchLatestRun", () => {
    function fakeApi(response: unknown): { api: ApiClient; get: ReturnType<typeof vi.fn> } {
      const get = vi.fn().mockResolvedValue(response);
      return { api: { get } as unknown as ApiClient, get };
    }

    it("requests the single most recent run and returns it", async () => {
      const run = { testRunId: "r1", status: "complete" };
      const { api, get } = fakeApi({ testRuns: [run] });

      const latest = await fetchLatestRun(api, "abc123");

      expect(get).toHaveBeenCalledWith("/scenarios/abc123/testruns?limit=1&latest=true");
      expect(latest).toEqual(run);
    });

    it("returns undefined when the scenario has no runs", async () => {
      const { api } = fakeApi({ testRuns: [] });
      expect(await fetchLatestRun(api, "abc123")).toBeUndefined();
    });

    it("url-encodes the testId", async () => {
      const { get } = fakeApi({ testRuns: [] });
      await fetchLatestRun({ get } as unknown as ApiClient, "a b/c");
      expect(get).toHaveBeenCalledWith("/scenarios/a%20b%2Fc/testruns?limit=1&latest=true");
    });
  });

  describe("renderRun", () => {
    const run = { testRunId: "r1", status: "complete", results: { total: { succ: 100, fail: 0 } } } as TestRun;

    beforeEach(() => vi.mocked(printResult).mockClear());

    it("prints the colored curated row for table", () => {
      renderRun(run, "table");
      const [value, opts] = vi.mocked(printResult).mock.calls[0]!;
      expect(opts).toEqual({ format: "table" });
      expect((value as Record<string, unknown>)["testRunId"]).toBe("r1");
    });

    it("prints the plain curated row for csv", () => {
      renderRun(run, "csv");
      expect(printResult).toHaveBeenCalledWith(
        expect.objectContaining({ testRunId: "r1", status: "complete" }),
        { format: "csv" }
      );
    });

    it("emits the raw jsonValue for json when provided", () => {
      const raw = { testRunId: "r1", extra: "kept" };
      renderRun(run, "json", raw);
      expect(printResult).toHaveBeenCalledWith(raw, { format: "json" });
    });

    it("falls back to the curated row for json when no jsonValue is given", () => {
      renderRun(run, "json");
      const [value] = vi.mocked(printResult).mock.calls[0]!;
      // The curated row has the canonical columns, not a raw passthrough.
      expect(Object.keys(value as Record<string, unknown>)).toEqual(CANONICAL_COLUMNS);
    });
  });
});
