// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTestRunColumns } from "../../pages/scenarios/hooks/useTestRunColumns";
import type { TestRun } from "../../pages/scenarios/types";

const mockTestRun: TestRun = {
  testRunId: "run-001",
  startTime: "2025-01-15 10:30:00",
  endTime: "2025-01-15 11:00:00",
  status: "complete",
  requests: 5000,
  success: 4900,
  errors: 100,
  requestsPerSecond: 83.33,
  avgResponseTime: 120.5,
  avgLatency: 45.2,
  avgConnectionTime: 10.3,
  avgBandwidth: 2048,
  percentiles: {
    p0: 5.0,
    p50: 50.0,
    p90: 100.0,
    p95: 150.0,
    p99: 200.0,
    p99_9: 250.0,
    p100: 500.0,
  },
};

const mockBaselineRun: TestRun = {
  testRunId: "run-baseline",
  startTime: "2025-01-10 10:00:00",
  status: "complete",
  requests: 4800,
  success: 4700,
  errors: 100,
  requestsPerSecond: 80.0,
  avgResponseTime: 130.0,
  avgLatency: 50.0,
  avgConnectionTime: 12.0,
  avgBandwidth: 1900,
  isBaseline: true,
  percentiles: {
    p0: 4.0,
    p50: 55.0,
    p90: 110.0,
    p95: 160.0,
    p99: 210.0,
    p99_9: 260.0,
    p100: 520.0,
  },
};

describe("useTestRunColumns", () => {
  const testId = "test-123";
  const onTestRunClick = vi.fn();

  describe("without baseline", () => {
    it("returns allColumns with standard columns", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const { allColumns } = result.current;

      expect(allColumns.length).toBeGreaterThan(0);
      // Should have: testRun, testRunId, status, investigation + 8 metrics + 7 percentiles = 19
      expect(allColumns.length).toBe(19);
    });

    it("includes testRun (start time), testRunId, and status columns", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const { allColumns } = result.current;

      const ids = allColumns.map((c) => c.id);
      expect(ids).toContain("testRun");
      expect(ids).toContain("testRunId");
      expect(ids).toContain("status");
    });

    it("includes all metric columns", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const { allColumns } = result.current;

      const ids = allColumns.map((c) => c.id);
      expect(ids).toContain("requests");
      expect(ids).toContain("success");
      expect(ids).toContain("errors");
      expect(ids).toContain("requestsPerSecond");
      expect(ids).toContain("avgResponseTime");
      expect(ids).toContain("avgLatency");
      expect(ids).toContain("avgConnectionTime");
      expect(ids).toContain("avgBandwidth");
    });

    it("includes all percentile columns", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const { allColumns } = result.current;

      const ids = allColumns.map((c) => c.id);
      expect(ids).toContain("p100");
      expect(ids).toContain("p99_9");
      expect(ids).toContain("p99");
      expect(ids).toContain("p95");
      expect(ids).toContain("p90");
      expect(ids).toContain("p50");
      expect(ids).toContain("p0");
    });

    it("formats start time correctly via cell function", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const startTimeCol = result.current.allColumns.find((c) => c.id === "testRun")!;
      const cellValue = startTimeCol.cell(mockTestRun);
      expect(typeof cellValue).toBe("string");
      expect(cellValue).not.toBe("-");
    });

    it("formats status with StatusIndicator", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const statusCol = result.current.allColumns.find((c) => c.id === "status")!;
      const cellValue = statusCol.cell(mockTestRun);
      // Should return a React element (StatusIndicator)
      expect(cellValue).toBeDefined();
      expect(typeof cellValue).not.toBe("string");
    });

    it("returns '-' for unknown status", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const statusCol = result.current.allColumns.find((c) => c.id === "status")!;
      const noStatusRun = { ...mockTestRun, status: undefined };
      expect(statusCol.cell(noStatusRun)).toBe("-");
    });

    it("formats metric values correctly via csvValue", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));

      const requestsCol = result.current.allColumns.find((c) => c.id === "requests")!;
      expect(requestsCol.csvValue(mockTestRun)).toBe("5,000");

      const rpsCol = result.current.allColumns.find((c) => c.id === "requestsPerSecond")!;
      expect(rpsCol.csvValue(mockTestRun)).toBe("83.33");

      const avgRtCol = result.current.allColumns.find((c) => c.id === "avgResponseTime")!;
      expect(avgRtCol.csvValue(mockTestRun)).toBe("120.50ms");

      const bwCol = result.current.allColumns.find((c) => c.id === "avgBandwidth")!;
      expect(bwCol.csvValue(mockTestRun)).toBe("2.00 KB/s");
    });

    it("returns '--' for missing metric values", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const requestsCol = result.current.allColumns.find((c) => c.id === "requests")!;
      const emptyRun: TestRun = { testRunId: "empty", startTime: "2025-01-01 00:00:00" };
      expect(requestsCol.csvValue(emptyRun)).toBe("--");
    });

    it("formats percentile csvValue correctly", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const p50Col = result.current.allColumns.find((c) => c.id === "p50")!;
      expect(p50Col.csvValue(mockTestRun)).toBe("50.00ms");
    });

    it("returns '--' for missing percentile values", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const p50Col = result.current.allColumns.find((c) => c.id === "p50")!;
      const noPerc: TestRun = { testRunId: "empty", startTime: "2025-01-01 00:00:00" };
      expect(p50Col.csvValue(noPerc)).toBe("--");
    });
  });

  describe("with baseline", () => {
    it("includes baseline text in metric headers", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, mockBaselineRun, onTestRunClick));
      const requestsCol = result.current.allColumns.find((c) => c.id === "requests")!;
      expect(requestsCol.header).toContain("Baseline");
    });

    it("provides csvBaselineValue for metrics when baseline is set", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, mockBaselineRun, onTestRunClick));
      const requestsCol = result.current.allColumns.find((c) => c.id === "requests")!;
      expect(requestsCol.csvBaselineValue).toBeDefined();
      const delta = requestsCol.csvBaselineValue!(mockTestRun);
      expect(delta).toContain("%");
    });

    it("provides csvBaselineValue for percentiles when baseline is set", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, mockBaselineRun, onTestRunClick));
      const p50Col = result.current.allColumns.find((c) => c.id === "p50")!;
      expect(p50Col.csvBaselineValue).toBeDefined();
      const delta = p50Col.csvBaselineValue!(mockTestRun);
      expect(delta).toContain("%");
    });
  });

  describe("getFilteredColumns", () => {
    it("returns only visible columns based on preferences", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const { getFilteredColumns } = result.current;

      const preferences = {
        contentDisplay: [
          { id: "testRun", visible: true },
          { id: "testRunId", visible: true },
          { id: "status", visible: false },
          { id: "requests", visible: true },
        ],
      };

      const filtered = getFilteredColumns(preferences);
      expect(filtered).toHaveLength(3);
      expect(filtered.map((c: any) => c.id)).toEqual(["testRun", "testRunId", "requests"]);
    });

    it("returns empty array when no columns are visible", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const { getFilteredColumns } = result.current;

      const preferences = {
        contentDisplay: [
          { id: "testRun", visible: false },
          { id: "testRunId", visible: false },
        ],
      };

      const filtered = getFilteredColumns(preferences);
      expect(filtered).toHaveLength(0);
    });

    it("handles sorting comparator for percentiles", () => {
      const { result } = renderHook(() => useTestRunColumns(testId, null, onTestRunClick));
      const p50Col = result.current.allColumns.find((c) => c.id === "p50")!;

      const runA: TestRun = { testRunId: "a", startTime: "", percentiles: { p50: 100 } };
      const runB: TestRun = { testRunId: "b", startTime: "", percentiles: { p50: 200 } };

      expect((p50Col as any).sortingComparator(runA, runB)).toBeLessThan(0);
      expect((p50Col as any).sortingComparator(runB, runA)).toBeGreaterThan(0);
    });
  });
});
