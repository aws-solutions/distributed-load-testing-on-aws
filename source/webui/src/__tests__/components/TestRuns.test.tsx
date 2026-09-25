// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MAX_TEST_RUNS_PER_DELETE_REQUEST } from "@amzn/dlt-common/validation";
import { TestRuns } from "../../pages/scenarios/components/TestRuns";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";
import { TestStatus } from "@amzn/dlt-common/validation";

const { refetchMock } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
}));

vi.mock("../../pages/scenarios/hooks/useTestRuns", () => ({
  useTestRuns: () => ({
    dateFilter: null,
    baselineTestRun: null,
    allTestRuns: [
      {
        testRunId: "run-001",
        startTime: "2025-01-01 00:00:00",
        endTime: "2025-01-01 00:10:00",
        status: TestStatus.COMPLETE,
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
    firstPageData: {
      testRuns: [
        { testRunId: "run-001" },
        { testRunId: "run-002" },
      ],
      pagination: { total_count: 2 },
    },
    isSettingBaseline: false,
    isRemovingBaseline: false,
    handleSetBaseline: vi.fn(),
    handleRemoveBaseline: vi.fn(),
    handleDateFilterChange: vi.fn(),
    refetch: refetchMock,
  }),
}));

vi.mock("../../pages/scenarios/hooks/useTestRunColumns", () => ({
  useTestRunColumns: () => {
    const allColumns = [
      { id: "testRun", header: "Test Run", cell: (item: any) => item.testRunId, csvValue: (item: any) => item.testRunId, preferenceHeader: "Test Run" },
      { id: "status", header: "Test Run Status", cell: (item: any) => item.status, csvValue: (item: any) => item.status, preferenceHeader: "Test Run Status" },
      { id: "requests", header: "Requests", cell: (item: any) => item.requests, csvValue: (item: any) => String(item.requests), preferenceHeader: "Requests" },
    ];
    return {
      allColumns,
      getFilteredColumns: (preferences: any) => preferences.contentDisplay
        .filter(({ visible }: any) => visible)
        .map(({ id }: any) => allColumns.find((column) => column.id === id))
        .filter(Boolean),
    };
  },
}));

function createStore() {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });
}

function renderComponent() {
  const store = createStore();
  const component = (
    <MemoryRouter>
      <Provider store={store}>
        <TestRuns testId="test-123" />
      </Provider>
    </MemoryRouter>
  );
  return render(component);
}

beforeEach(() => {
  vi.restoreAllMocks();
  refetchMock.mockClear();
  localStorage.clear();
});

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

  test("includes a newly polled run in the table count", async () => {
    const useTestRunsMock = await import("../../pages/scenarios/hooks/useTestRuns");
    vi.spyOn(useTestRunsMock, "useTestRuns").mockReturnValueOnce({
      ...useTestRunsMock.useTestRuns("test-123"),
      allTestRuns: [
        {
          testRunId: "run-003",
          startTime: "2025-01-03 00:00:00",
          status: TestStatus.RUNNING,
        },
        {
          testRunId: "run-002",
          startTime: "2025-01-02 00:00:00",
          status: TestStatus.COMPLETE,
        },
      ],
      firstPageData: {
        testRuns: [{
          testRunId: "run-002",
          startTime: "2025-01-02 00:00:00",
          status: TestStatus.COMPLETE,
        }],
        pagination: { total_count: 2 },
      },
    });

    renderComponent();

    expect(screen.getByText("(3)")).toBeInTheDocument();
  });
});

describe("TestRuns - baseline delete prevention", () => {
  test("shows alert and disables Delete button when baseline test run is selected for deletion", async () => {
    const useTestRunsMock = await import("../../pages/scenarios/hooks/useTestRuns");
    vi.spyOn(useTestRunsMock, "useTestRuns").mockReturnValue({
      dateFilter: null,
      baselineTestRun: {
        testRunId: "run-001",
        startTime: "2025-01-01 00:00:00",
        endTime: "2025-01-01 00:10:00",
        status: TestStatus.COMPLETE,
        isBaseline: true,
        requests: 1000,
        success: 950,
        errors: 50,
        requestsPerSecond: 16.67,
        avgResponseTime: 120,
      },
      allTestRuns: [
        {
          testRunId: "run-001",
          startTime: "2025-01-01 00:00:00",
          endTime: "2025-01-01 00:10:00",
          status: TestStatus.COMPLETE,
          isBaseline: true,
          requests: 1000,
          success: 950,
          errors: 50,
          requestsPerSecond: 16.67,
          avgResponseTime: 120,
        },
      ],
      isLoadingMore: false,
      isLoading: false,
      error: undefined,
      baselineError: undefined,
      firstPageData: { testRuns: [], pagination: { total_count: 1 } },
      isSettingBaseline: false,
      isRemovingBaseline: false,
      handleSetBaseline: vi.fn(),
      handleRemoveBaseline: vi.fn(),
      handleDateFilterChange: vi.fn(),
      refetch: vi.fn(),
    });

    renderComponent();

    // Select the baseline test run via the row checkbox
    const checkbox = screen.getAllByRole("checkbox")[1];
    fireEvent.click(checkbox);

    // Click the Delete button in the table header (first one)
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[0]);

    // Verify the modal shows the baseline alert
    await waitFor(() => {
      expect(screen.getByText(/currently set as the baseline/)).toBeInTheDocument();
    });

    // Verify the modal's Delete button is disabled
    const modalDeleteButton = screen.getByTestId("modal-delete-button");
    expect(modalDeleteButton).toBeDisabled();
  });
});

describe("TestRuns - batch delete limit", () => {
  const completedRuns = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      testRunId: `run-${index}`,
      startTime: "2025-01-01 00:00:00",
      endTime: "2025-01-01 00:10:00",
      status: TestStatus.COMPLETE,
      requests: 1000,
      success: 1000,
      errors: 0,
      requestsPerSecond: 10,
      avgResponseTime: 100,
    }));

  const mockCompletedRuns = async (count: number) => {
    const useTestRunsMock = await import("../../pages/scenarios/hooks/useTestRuns");
    vi.spyOn(useTestRunsMock, "useTestRuns").mockReturnValueOnce({
      dateFilter: null,
      baselineTestRun: null,
      allTestRuns: completedRuns(count),
      isLoadingMore: false,
      isLoading: false,
      error: undefined,
      baselineError: undefined,
      firstPageData: { testRuns: [], pagination: { total_count: count } },
      isSettingBaseline: false,
      isRemovingBaseline: false,
      handleSetBaseline: vi.fn(),
      handleRemoveBaseline: vi.fn(),
      handleDateFilterChange: vi.fn(),
      refetch: vi.fn(),
    });
    localStorage.setItem("testRunsTablePreferences", JSON.stringify({ pageSize: 50 }));
  };

  const selectAllAndOpenDeleteModal = () => {
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  };

  test("allows deleting the maximum number of test runs", async () => {
    await mockCompletedRuns(MAX_TEST_RUNS_PER_DELETE_REQUEST);
    renderComponent();
    selectAllAndOpenDeleteModal();

    await waitFor(() => expect(screen.getByTestId("modal-delete-button")).toBeEnabled());
    expect(screen.queryByText(/You can delete a maximum of/)).not.toBeInTheDocument();
  });

  test("shows an alert and blocks deletion over the maximum", async () => {
    await mockCompletedRuns(MAX_TEST_RUNS_PER_DELETE_REQUEST + 1);
    renderComponent();
    selectAllAndOpenDeleteModal();

    await waitFor(() => {
      expect(
        screen.getByText(
          `You can delete a maximum of ${MAX_TEST_RUNS_PER_DELETE_REQUEST} test runs at a time. Reduce your selection and try again.`
        )
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("modal-delete-button")).toBeDisabled();
  });
});
