// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";
import { setupStore } from "../../store/store";
import { useTestRuns } from "../../pages/scenarios/hooks/useTestRuns";
import type { TestRun } from "../../pages/scenarios/types";
import { TestStatus } from "@amzn/dlt-common/validation";
import { http, HttpResponse } from "msw";
import { server, MOCK_SERVER_URL } from "../server";

vi.mock("../../utils/consoleMetrics", () => ({
  sendConsoleMetric: vi.fn(),
}));

const API = MOCK_SERVER_URL;

function createWrapper() {
  const store = setupStore();

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(Provider, { store, children });
}

describe("useTestRuns", () => {
  const testId = "test-hook-123";

  beforeEach(() => {
    localStorage.clear();
    server.use(
      http.get(`${API}/scenarios/${testId}/testruns`, () => {
        return HttpResponse.json({
          testRuns: [
            { testRunId: "run-001", startTime: "2025-01-15 10:00:00", status: "complete" },
            { testRunId: "run-002", startTime: "2025-01-14 10:00:00", status: "complete" },
          ],
          pagination: {},
        });
      }),
      http.get(`${API}/scenarios/${testId}/baseline`, () => {
        return HttpResponse.json({ baselineId: null });
      })
    );
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("starts with loading state and empty test runs", () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.allTestRuns).toEqual([]);
    expect(result.current.baselineTestRun).toBeNull();
  });

  it("loads test runs from API", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.allTestRuns).toHaveLength(2);
    expect(result.current.allTestRuns[0].testRunId).toBe("run-001");
  });

  it("returns null baseline when API says no baseline", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.baselineTestRun).toBeNull();
  });

  it("initializes dateFilter from localStorage", () => {
    const filter = { type: "relative", amount: 7, unit: "day" };
    localStorage.setItem(`dateFilter-${testId}`, JSON.stringify(filter));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    expect(result.current.dateFilter).toEqual(filter);
  });

  it("leaves relative filters open-ended for new runs", async () => {
    let requestUrl: URL | undefined;
    localStorage.setItem(`dateFilter-${testId}`, JSON.stringify({ type: "relative", amount: 7, unit: "day" }));
    server.use(
      http.get(`${API}/scenarios/${testId}/testruns`, ({ request }) => {
        requestUrl = new URL(request.url);
        return HttpResponse.json({ testRuns: [], pagination: {} });
      }),
    );

    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(requestUrl).toBeDefined();
    expect(requestUrl!.searchParams.get("start_timestamp")).not.toBeNull();
    expect(requestUrl!.searchParams.get("end_timestamp")).toBeNull();
  });

  it("initializes baseline from localStorage", () => {
    const baseline = { testRunId: "run-saved", startTime: "2025-01-01 00:00:00", isBaseline: true };
    localStorage.setItem(`baseline-${testId}`, JSON.stringify(baseline));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    expect(result.current.baselineTestRun).toEqual(baseline);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem(`dateFilter-${testId}`, "not-valid-json{{{");
    localStorage.setItem(`baseline-${testId}`, "also-broken");

    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    expect(result.current.dateFilter).toBeNull();
    expect(result.current.baselineTestRun).toBeNull();
  });

  it("handleSetBaseline does nothing with empty selection", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSetBaseline([]);
    });

    expect(result.current.baselineTestRun).toBeNull();
  });

  it("handleRemoveBaseline clears baseline and localStorage", async () => {
    localStorage.setItem(`baseline-${testId}`, JSON.stringify({ testRunId: "run-001", isBaseline: true }));

    server.use(
      http.delete(`${API}/scenarios/${testId}/baseline`, () => {
        return HttpResponse.json({ message: "OK" });
      })
    );

    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleRemoveBaseline();
    });

    expect(result.current.baselineTestRun).toBeNull();
    expect(localStorage.getItem(`baseline-${testId}`)).toBeNull();
  });

  it("handleDateFilterChange updates localStorage", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleDateFilterChange({ type: "relative", amount: 3, unit: "day" });
    });

    expect(localStorage.getItem(`dateFilter-${testId}`)).not.toBeNull();
  });

  it("handleDateFilterChange with null clears localStorage", async () => {
    localStorage.setItem(`dateFilter-${testId}`, JSON.stringify({ type: "relative", amount: 7, unit: "day" }));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleDateFilterChange(null);
    });

    await waitFor(() => {
      expect(localStorage.getItem(`dateFilter-${testId}`)).toBeNull();
    }, { timeout: 1000 });
  });

  it("returns refetch function", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.refetch).toBe("function");
  });

  it("refreshes only the latest run and preserves loaded history", async () => {
    let pageTwoRequests = 0;
    server.use(
      http.get(`${API}/scenarios/${testId}/testruns`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("next_token")) {
          pageTwoRequests++;
          return HttpResponse.json({
            testRuns: [{ testRunId: "run-001", startTime: "2025-01-14 10:00:00", status: "complete" }],
            pagination: {},
          });
        }
        return HttpResponse.json({
          testRuns: [{ testRunId: "run-002", startTime: "2025-01-15 10:00:00", status: "complete" }],
          pagination: { next_token: "page-2" },
        });
      })
    );

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ latestTestRun }) => useTestRuns(testId, latestTestRun),
      { wrapper, initialProps: { latestTestRun: undefined as TestRun | undefined } },
    );

    await waitFor(() => {
      expect(result.current.allTestRuns).toHaveLength(2);
    });

    rerender({
      latestTestRun: { testRunId: "run-002", startTime: "2025-01-15 10:00:00", status: TestStatus.RUNNING },
    });

    expect(pageTwoRequests).toBe(1);
    expect(result.current.allTestRuns.map(({ testRunId }) => testRunId)).toEqual(["run-002", "run-001"]);
    expect(result.current.allTestRuns[0].status).toBe(TestStatus.RUNNING);

    rerender({
      latestTestRun: { testRunId: "run-003", startTime: "2025-01-16 10:00:00", status: TestStatus.RUNNING },
    });

    expect(pageTwoRequests).toBe(1);
    expect(result.current.allTestRuns.map(({ testRunId }) => testRunId)).toEqual([
      "run-003",
      "run-002",
      "run-001",
    ]);
  });

  it("preserves a newer polled run when progressive loading finishes", async () => {
    let releasePageTwo!: () => void;
    const pageTwoBlocked = new Promise<void>(resolve => {
      releasePageTwo = resolve;
    });

    server.use(
      http.get(`${API}/scenarios/${testId}/testruns`, async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("next_token")) {
          await pageTwoBlocked;
          return HttpResponse.json({
            testRuns: [{ testRunId: "run-001", startTime: "2025-01-14 10:00:00", status: "complete" }],
            pagination: {},
          });
        }
        return HttpResponse.json({
          testRuns: [{ testRunId: "run-002", startTime: "2025-01-15 10:00:00", status: "complete" }],
          pagination: { next_token: "page-2" },
        });
      })
    );

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ latestTestRun }) => useTestRuns(testId, latestTestRun),
      { wrapper, initialProps: { latestTestRun: undefined as TestRun | undefined } },
    );

    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(true);
    });

    rerender({
      latestTestRun: { testRunId: "run-003", startTime: "2025-01-16 10:00:00", status: TestStatus.RUNNING },
    });
    expect(result.current.allTestRuns[0].testRunId).toBe("run-003");

    releasePageTwo();
    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
    });

    expect(result.current.allTestRuns.map(({ testRunId }) => testRunId)).toEqual([
      "run-003",
      "run-002",
      "run-001",
    ]);
  });

  it("does not merge a latest run outside the active date filter", async () => {
    localStorage.setItem(`dateFilter-${testId}`, JSON.stringify({ type: "relative", amount: 1, unit: "day" }));
    server.use(
      http.get(`${API}/scenarios/${testId}/testruns`, ({ request }) => {
        return HttpResponse.json({
          testRuns: [{ testRunId: "run-current", startTime: "2026-09-08 00:00:00", status: "complete" }],
          pagination: {},
        });
      })
    );

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ latestTestRun }) => useTestRuns(testId, latestTestRun),
      { wrapper, initialProps: { latestTestRun: undefined as TestRun | undefined } },
    );

    await waitFor(() => {
      expect(result.current.allTestRuns).toHaveLength(1);
    });

    rerender({
      latestTestRun: { testRunId: "run-old", startTime: "2000-01-01 00:00:00", status: TestStatus.COMPLETE },
    });

    expect(result.current.allTestRuns[0].testRunId).toBe("run-current");
  });

  it("progressive loading fetches additional pages", async () => {
    server.use(
      http.get(`${API}/scenarios/${testId}/testruns`, ({ request }) => {
        const url = new URL(request.url);
        const nextToken = url.searchParams.get("next_token");
        if (!nextToken) {
          return HttpResponse.json({
            testRuns: [{ testRunId: "run-page1", startTime: "2025-01-15 10:00:00", status: "complete" }],
            pagination: { next_token: "page2-token" },
          });
        }
        return HttpResponse.json({
          testRuns: [{ testRunId: "run-page2", startTime: "2025-01-14 10:00:00", status: "complete" }],
          pagination: {},
        });
      })
    );

    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.allTestRuns.length).toBe(2);
    }, { timeout: 5000 });

    expect(result.current.allTestRuns[0].testRunId).toBe("run-page1");
    expect(result.current.allTestRuns[1].testRunId).toBe("run-page2");
    expect(result.current.isLoadingMore).toBe(false);
  });
});
