// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import chalk from "chalk";
import {
  ACTIVE_STATUSES,
  isActive,
  curateRunRow,
  colorRunRow,
  colorBaselineRow,
  sleep,
  extractBaselineMetrics,
  computeBaselineDelta,
  curateRunRowWithBaseline,
  enrichRunWithBaseline,
  formatTimestamp,
} from "../../src/lib/run-formatters.js";
import { stripAnsi } from "../../src/lib/color.js";
import type { TestRun, BaselineResponse } from "../../src/lib/types.js";

describe("run-formatters", () => {
  describe("formatTimestamp", () => {
    it("appends UTC to a plain timestamp", () => {
      expect(formatTimestamp("2024-01-01 12:00:00")).toBe("2024-01-01 12:00:00 UTC");
    });

    it("returns empty string for empty input", () => {
      expect(formatTimestamp("")).toBe("");
    });

    it("does not double-append to timestamps ending with Z", () => {
      expect(formatTimestamp("2024-01-01T12:00:00Z")).toBe("2024-01-01T12:00:00Z");
    });

    it("does not double-append to timestamps with +/- offset", () => {
      expect(formatTimestamp("2024-01-01T12:00:00+00:00")).toBe("2024-01-01T12:00:00+00:00");
      expect(formatTimestamp("2024-01-01T12:00:00-07:00")).toBe("2024-01-01T12:00:00-07:00");
    });

    it("does not double-append if already contains UTC", () => {
      expect(formatTimestamp("2024-01-01 12:00:00 UTC")).toBe("2024-01-01 12:00:00 UTC");
    });
  });

  describe("ACTIVE_STATUSES", () => {
    it("contains running, pending, provisioning", () => {
      expect(ACTIVE_STATUSES.has("running")).toBe(true);
      expect(ACTIVE_STATUSES.has("pending")).toBe(true);
      expect(ACTIVE_STATUSES.has("provisioning")).toBe(true);
    });

    it("does not contain completed or failed", () => {
      expect(ACTIVE_STATUSES.has("completed")).toBe(false);
      expect(ACTIVE_STATUSES.has("failed")).toBe(false);
    });
  });

  describe("isActive", () => {
    it("returns true for active statuses (case-insensitive)", () => {
      expect(isActive("running")).toBe(true);
      expect(isActive("Running")).toBe(true);
      expect(isActive("PENDING")).toBe(true);
      expect(isActive("Provisioning")).toBe(true);
    });

    it("returns false for inactive statuses", () => {
      expect(isActive("completed")).toBe(false);
      expect(isActive("failed")).toBe(false);
      expect(isActive("cancelled")).toBe(false);
    });

    it("returns false for undefined or empty string", () => {
      expect(isActive(undefined)).toBe(false);
      expect(isActive("")).toBe(false);
    });
  });

  describe("curateRunRow", () => {
    it("handles flat fields from list API response", () => {
      const run: TestRun = {
        testRunId: "run-1",
        status: "completed",
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-01T01:00:00Z",
        requests: 1000,
        success: 990,
        errors: 10,
        avgResponseTime: 250,
        percentiles: { p50: 200, p90: 400, p99: 800 },
      };

      const row = curateRunRow(run);
      expect(row.testRunId).toBe("run-1");
      expect(row.status).toBe("completed");
      expect(row.startTime).toBe("2024-01-01T00:00:00Z");
      expect(row.endTime).toBe("2024-01-01T01:00:00Z");
      expect(row.requests).toBe(1000);
      expect(row.success).toBe(990);
      expect(row.errors).toBe(10);
      expect(row.avgResponseTime).toBe(250);
      expect(row.p50).toBe(200);
      expect(row.p90).toBe(400);
      expect(row.p99).toBe(800);
    });

    it("handles nested results.total from single-run GET endpoint", () => {
      const run: TestRun = {
        testRunId: "run-2",
        status: "completed",
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-01T01:00:00Z",
        results: {
          total: {
            avg_rt: "0.250",
            p50_0: "0.200",
            p90_0: "0.400",
            p99_0: "0.800",
            succ: "990",
            fail: "10",
          },
        },
      };

      const row = curateRunRow(run);
      expect(row.testRunId).toBe("run-2");
      expect(row.avgResponseTime).toBe(250);
      expect(row.p50).toBe(200);
      expect(row.p90).toBe(400);
      expect(row.p99).toBe(800);
      expect(row.errors).toBe("10");
    });

    it("returns empty strings for missing flat fields with no nested fallback", () => {
      const run: TestRun = {
        testRunId: "run-3",
        status: "running",
      };

      const row = curateRunRow(run);
      expect(row.testRunId).toBe("run-3");
      expect(row.status).toBe("running");
      expect(row.startTime).toBe("");
      expect(row.endTime).toBe("");
      expect(row.requests).toBe("");
      expect(row.success).toBe("");
      expect(row.errors).toBe("");
      expect(row.avgResponseTime).toBe("");
      expect(row.p50).toBe("");
      expect(row.p90).toBe("");
      expect(row.p99).toBe("");
    });

    it("handles nested results.total with undefined/null/NaN values", () => {
      const run: TestRun = {
        testRunId: "run-4",
        status: "completed",
        results: {
          total: {
            avg_rt: "not-a-number",
            p50_0: undefined,
            p90_0: null,
            p99_0: "0.5",
            succ: "100",
            fail: "0",
          },
        },
      };

      const row = curateRunRow(run);
      expect(row.avgResponseTime).toBe("");
      expect(row.p50).toBe("");
      expect(row.p90).toBe("");
      expect(row.p99).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Baseline helpers
  // -------------------------------------------------------------------------

  describe("extractBaselineMetrics", () => {
    it("returns null when baselineId is null", () => {
      const resp: BaselineResponse = { testId: "t1", baselineId: null, message: "none" };
      expect(extractBaselineMetrics(resp)).toBeNull();
    });

    it("returns null when testRunDetails has no results", () => {
      const resp: BaselineResponse = {
        testId: "t1",
        baselineId: "r1",
        message: "ok",
        testRunDetails: {
          testRunId: "r1",
          startTime: "2024-01-01",
          endTime: "2024-01-02",
          status: "complete",
          results: {},
        },
      };
      expect(extractBaselineMetrics(resp)).toBeNull();
    });

    it("extracts metrics from results.total", () => {
      const resp: BaselineResponse = {
        testId: "t1",
        baselineId: "r1",
        message: "ok",
        testRunDetails: {
          testRunId: "r1",
          startTime: "2024-01-01",
          endTime: "2024-01-02",
          status: "complete",
          results: {
            total: {
              throughput: 3811,
              succ: 3811,
              fail: 0,
              avg_rt: "0.250",
              p50_0: "0.200",
              p90_0: "0.400",
              p99_0: "0.800",
              testDuration: "90",
            },
          },
        },
      };
      const m = extractBaselineMetrics(resp);
      expect(m).not.toBeNull();
      expect(m!.baselineRunId).toBe("r1");
      expect(m!.requests).toBe(3811);
      expect(m!.success).toBe(3811);
      expect(m!.errors).toBe(0);
      expect(m!.avgResponseTime).toBe(250);
      expect(m!.p50).toBe(200);
      expect(m!.p90).toBe(400);
      expect(m!.p99).toBe(800);
      expect(m!.requestsPerSecond).toBeCloseTo(42.34, 1);
    });
  });

  describe("computeBaselineDelta", () => {
    it("returns null for undefined current or baseline", () => {
      expect(computeBaselineDelta(undefined, 100)).toBeNull();
      expect(computeBaselineDelta(100, undefined)).toBeNull();
      expect(computeBaselineDelta(undefined, undefined)).toBeNull();
    });

    it("returns null for zero baseline with non-zero current", () => {
      expect(computeBaselineDelta(100, 0)).toBeNull();
    });

    it("returns 0.0% for both zero", () => {
      const d = computeBaselineDelta(0, 0);
      expect(d).toEqual({ delta: 0, deltaText: "0.0%" });
    });

    it("computes positive delta", () => {
      const d = computeBaselineDelta(4792, 3811);
      expect(d).not.toBeNull();
      expect(d!.delta).toBeCloseTo(25.7, 0);
      expect(d!.deltaText).toMatch(/^\+25\.\d%$/);
    });

    it("computes negative delta", () => {
      const d = computeBaselineDelta(3521, 3811);
      expect(d).not.toBeNull();
      expect(d!.delta).toBeLessThan(0);
      expect(d!.deltaText).toMatch(/^-7\.\d%$/);
    });

    it("computes zero delta", () => {
      const d = computeBaselineDelta(3811, 3811);
      expect(d).toEqual({ delta: 0, deltaText: "0.0%" });
    });
  });

  describe("curateRunRowWithBaseline", () => {
    const bm = {
      baselineRunId: "base-1",
      requests: 3811,
      success: 3811,
      errors: 0,
      avgResponseTime: 250,
      requestsPerSecond: 42.34,
      p50: 200,
      p90: 400,
      p99: 800,
    };

    it("adds delta columns to the table row", () => {
      const run: TestRun = {
        testRunId: "r1",
        status: "completed",
        startTime: "2024-01-01",
        requests: 4792,
        success: 4792,
        errors: 0,
        avgResponseTime: 320,
        percentiles: { p50: 250, p90: 500, p99: 1000 },
      };

      const row = curateRunRowWithBaseline(run, bm);
      expect(row["testRunId"]).toBe("r1");
      expect(row["requests"]).toBe(4792);
      // Delta column key includes baseline value
      const deltaKey = Object.keys(row).find((k) => k.startsWith("Δ requests"));
      expect(deltaKey).toBeDefined();
      expect(row[deltaKey!]).toMatch(/^\+/);
    });

    it("shows '--' for runs without metric data", () => {
      const run: TestRun = {
        testRunId: "r2",
        status: "running",
      };

      const row = curateRunRowWithBaseline(run, bm);
      const deltaKey = Object.keys(row).find((k) => k.startsWith("Δ requests"));
      expect(row[deltaKey!]).toBe("--");
    });

    it("produces 0.0% deltas when the baseline run is compared against itself", () => {
      // Regression: extractBaselineMetrics used Math.round (e.g. 22.07 → 22)
      // while the list API returned the unrounded value (22.07), causing a
      // non-zero delta for the baseline row itself.
      const baselineMetrics = {
        baselineRunId: "base-1",
        requests: 3811,
        success: 3811,
        errors: 0,
        avgResponseTime: 22.07,
        requestsPerSecond: 42.34,
        p50: 19,
        p90: 26,
        p99: 81,
      };

      const run: TestRun = {
        testRunId: "base-1",
        status: "complete",
        requests: 3811,
        success: 3811,
        errors: 0,
        avgResponseTime: 22.07,
        percentiles: { p50: 19, p90: 26, p99: 81 },
      };

      const row = curateRunRowWithBaseline(run, baselineMetrics);

      const reqDelta = Object.keys(row).find((k) => k.startsWith("Δ requests"));
      const sucDelta = Object.keys(row).find((k) => k.startsWith("Δ success"));
      const rtDelta = Object.keys(row).find((k) => k.startsWith("Δ avgRespTime"));

      expect(row[reqDelta!]).toBe("0.0%");
      expect(row[sucDelta!]).toBe("0.0%");
      expect(row[rtDelta!]).toBe("0.0%");
    });
  });

  describe("enrichRunWithBaseline", () => {
    const bm = {
      baselineRunId: "base-1",
      requests: 3811,
      success: 3811,
      errors: 0,
      avgResponseTime: 250,
      requestsPerSecond: 42.34,
      p50: 200,
      p90: 400,
      p99: 800,
    };

    it("adds baseline comparison object to JSON output", () => {
      const run: TestRun = {
        testRunId: "r1",
        status: "completed",
        requests: 4792,
        success: 4792,
        errors: 0,
        avgResponseTime: 320,
        percentiles: { p50: 250, p90: 500, p99: 1000 },
      };

      const result = enrichRunWithBaseline(run, bm);
      expect(result["testRunId"]).toBe("r1");

      const baseline = result["baseline"] as Record<string, unknown>;
      expect(baseline["baselineRunId"]).toBe("base-1");

      const reqDelta = baseline["requests"] as { baselineValue: number; delta: string };
      expect(reqDelta.baselineValue).toBe(3811);
      expect(reqDelta.delta).toMatch(/^\+/);
    });

    it("preserves original run fields", () => {
      const run: TestRun = {
        testRunId: "r1",
        status: "completed",
        requests: 3811,
        someCustomField: "hello",
      };

      const result = enrichRunWithBaseline(run, bm);
      expect(result["someCustomField"]).toBe("hello");
      expect(result["testRunId"]).toBe("r1");
    });

    it("shows '--' delta for missing run metrics", () => {
      const run: TestRun = {
        testRunId: "r2",
        status: "running",
      };

      const result = enrichRunWithBaseline(run, bm);
      const baseline = result["baseline"] as Record<string, unknown>;
      const reqDelta = baseline["requests"] as { baselineValue: number; delta: string };
      expect(reqDelta.delta).toBe("--");
    });
  });

  describe("colorRunRow", () => {
    it("colors status field based on value", () => {
      const row = curateRunRow({
        testRunId: "r1",
        status: "completed",
        requests: 1000,
        errors: 5,
      } as TestRun);
      const colored = colorRunRow(row);

      // Status should be colored green
      expect(colored["status"]).toBe(chalk.green("completed"));
      expect(stripAnsi(colored["status"] as string)).toBe("completed");
    });

    it("colors non-zero errors red", () => {
      const row = curateRunRow({
        testRunId: "r1",
        status: "completed",
        errors: 10,
      } as TestRun);
      const colored = colorRunRow(row);

      expect(colored["errors"]).toBe(chalk.red("10"));
    });

    it("does not color zero errors", () => {
      const row = curateRunRow({
        testRunId: "r1",
        status: "completed",
        errors: 0,
      } as TestRun);
      const colored = colorRunRow(row);

      expect(colored["errors"]).toBe("0");
    });

    it("does not color empty errors", () => {
      const row = curateRunRow({
        testRunId: "r1",
        status: "running",
      } as TestRun);
      const colored = colorRunRow(row);

      // Empty string errors should stay empty
      expect(colored["errors"]).toBe("");
    });

    it("does not mutate the input row", () => {
      const row = curateRunRow({
        testRunId: "r1",
        status: "failed",
        errors: 5,
      } as TestRun);
      const original = { ...row };
      colorRunRow(row);

      expect(row).toEqual(original);
    });
  });

  describe("colorBaselineRow", () => {
    const bm = {
      baselineRunId: "base-1",
      requests: 3811,
      success: 3811,
      errors: 0,
      avgResponseTime: 250,
      requestsPerSecond: 42.34,
      p50: 200,
      p90: 400,
      p99: 800,
    };

    it("colors throughput delta columns with correct semantics", () => {
      const run: TestRun = {
        testRunId: "r1",
        status: "completed",
        requests: 4792,
        success: 4792,
        errors: 0,
        avgResponseTime: 320,
        percentiles: { p50: 250, p90: 500, p99: 1000 },
      };

      const row = curateRunRowWithBaseline(run, bm);
      const colored = colorBaselineRow(row);

      // Find the Δ requests column — throughput increase is green
      const reqDeltaKey = Object.keys(colored).find((k) => k.startsWith("Δ requests"));
      expect(reqDeltaKey).toBeDefined();
      const reqDelta = colored[reqDeltaKey!] as string;
      expect(stripAnsi(reqDelta)).toMatch(/^\+/);
      // Should be colored green (throughput increase is good)
      expect(reqDelta).toBe(chalk.green(stripAnsi(reqDelta)));
    });

    it("colors latency delta columns with correct semantics", () => {
      const run: TestRun = {
        testRunId: "r1",
        status: "completed",
        requests: 3811,
        success: 3811,
        errors: 0,
        avgResponseTime: 320,
        percentiles: { p50: 250, p90: 500, p99: 1000 },
      };

      const row = curateRunRowWithBaseline(run, bm);
      const colored = colorBaselineRow(row);

      // Find the Δ avgRespTime column — latency increase is red
      const latDeltaKey = Object.keys(colored).find((k) => k.startsWith("Δ avgRespTime"));
      expect(latDeltaKey).toBeDefined();
      const latDelta = colored[latDeltaKey!] as string;
      expect(stripAnsi(latDelta)).toMatch(/^\+/);
      // Should be colored red (latency increase is bad)
      expect(latDelta).toBe(chalk.red(stripAnsi(latDelta)));
    });

    it("dims '--' delta values", () => {
      const run: TestRun = {
        testRunId: "r2",
        status: "running",
      };

      const row = curateRunRowWithBaseline(run, bm);
      const colored = colorBaselineRow(row);

      const reqDeltaKey = Object.keys(colored).find((k) => k.startsWith("Δ requests"));
      const delta = colored[reqDeltaKey!] as string;
      expect(stripAnsi(delta)).toBe("--");
      // Should be dimmed
      expect(delta).toBe(chalk.dim("--"));
    });

    it("also colors status and errors", () => {
      const run: TestRun = {
        testRunId: "r1",
        status: "failed",
        requests: 100,
        errors: 50,
      };

      const row = curateRunRowWithBaseline(run, bm);
      const colored = colorBaselineRow(row);

      expect(stripAnsi(colored["status"] as string)).toBe("failed");
      expect(colored["status"]).toBe(chalk.red("failed"));
    });

    it("marks the baseline run with a ◆ baseline indicator", () => {
      const run: TestRun = {
        testRunId: "base-1",
        status: "completed",
        requests: 3811,
        success: 3811,
        errors: 0,
        avgResponseTime: 250,
        percentiles: { p50: 200, p90: 400, p99: 800 },
      };

      const row = curateRunRowWithBaseline(run, bm);
      const colored = colorBaselineRow(row, "base-1");

      // testRunId should have the baseline marker appended
      expect(stripAnsi(colored["testRunId"] as string)).toBe("base-1 ◆ baseline");
    });

    it("does not mark non-baseline runs", () => {
      const run: TestRun = {
        testRunId: "other-run",
        status: "completed",
        requests: 4000,
      };

      const row = curateRunRowWithBaseline(run, bm);
      const colored = colorBaselineRow(row, "base-1");

      expect(stripAnsi(colored["testRunId"] as string)).toBe("other-run");
    });

    it("works without baselineRunId parameter", () => {
      const run: TestRun = {
        testRunId: "base-1",
        status: "completed",
        requests: 3811,
      };

      const row = curateRunRowWithBaseline(run, bm);
      const colored = colorBaselineRow(row);

      // No marker without baselineRunId
      expect(stripAnsi(colored["testRunId"] as string)).toBe("base-1");
    });
  });

  describe("sleep", () => {
    it("resolves after the specified time", async () => {
      vi.useFakeTimers();
      const promise = sleep(100);
      vi.advanceTimersByTime(100);
      await promise;
      vi.useRealTimers();
    });

    it("returns a promise", () => {
      const result = sleep(0);
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
