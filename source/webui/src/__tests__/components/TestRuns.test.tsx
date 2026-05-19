// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { TestRuns } from "../../pages/scenarios/components/TestRuns";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";

vi.mock("../../pages/scenarios/hooks/useTestRuns", () => ({
  useTestRuns: () => ({
    dateFilter: null,
    baselineTestRun: null,
    allTestRuns: [
      {
        testRunId: "run-001",
        startTime: "2025-01-01 00:00:00",
        endTime: "2025-01-01 00:10:00",
        status: "complete",
        requests: 1000,
        success: 950,
        errors: 50,
        requestsPerSecond: 16.67,
        avgResponseTime: 120,
      },
      {
        testRunId: "run-002",
        startTime: "2025-01-02 00:00:00",
        status: "running",
        requests: 500,
        success: 500,
        errors: 0,
        requestsPerSecond: 10,
        avgResponseTime: 80,
      },
    ],
    isLoadingMore: false,
    isLoading: false,
    error: null,
    baselineError: null,
    firstPageData: { pagination: { total_count: 2 } },
    isSettingBaseline: false,
    isRemovingBaseline: false,
    handleSetBaseline: vi.fn(),
    handleRemoveBaseline: vi.fn(),
    handleDateFilterChange: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("../../pages/scenarios/hooks/useTestRunColumns", () => ({
  useTestRunColumns: () => ({
    allColumns: [
      { id: "testRun", header: "Test Run", cell: (item: any) => item.testRunId, csvValue: (item: any) => item.testRunId, preferenceHeader: "Test Run" },
      { id: "requests", header: "Requests", cell: (item: any) => item.requests, csvValue: (item: any) => String(item.requests), preferenceHeader: "Requests" },
    ],
    getFilteredColumns: () => [
      { id: "testRun", header: "Test Run", cell: (item: any) => item.testRunId, csvValue: (item: any) => item.testRunId, preferenceHeader: "Test Run" },
      { id: "requests", header: "Requests", cell: (item: any) => item.requests, csvValue: (item: any) => String(item.requests), preferenceHeader: "Requests" },
    ],
  }),
}));

function createStore() {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <Provider store={createStore()}>
        <TestRuns testId="test-123" />
      </Provider>
    </MemoryRouter>,
  );
}

describe("TestRuns", () => {
  test("renders test runs table with data", () => {
    renderComponent();
    expect(screen.getByText("run-001")).toBeInTheDocument();
    expect(screen.getByText("run-002")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.queryByText("Loading test runs...")).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to load baseline data/)).not.toBeInTheDocument();
  });
});
