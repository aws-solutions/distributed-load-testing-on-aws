// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";
import { useTestRuns } from "../../pages/scenarios/hooks/useTestRuns";
import { http, HttpResponse } from "msw";
import { server, MOCK_SERVER_URL } from "../server";

vi.mock("../../utils/consoleMetrics", () => ({
  sendConsoleMetric: vi.fn(),
}));

const API = MOCK_SERVER_URL;

function createWrapper() {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });

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

  it("handleDateFilterChange updates localStorage after debounce", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useTestRuns(testId), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleDateFilterChange({ type: "relative", amount: 3, unit: "day" });
    });

    // Wait for debounce (300ms)
    await waitFor(() => {
      expect(localStorage.getItem(`dateFilter-${testId}`)).not.toBeNull();
    }, { timeout: 1000 });
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
