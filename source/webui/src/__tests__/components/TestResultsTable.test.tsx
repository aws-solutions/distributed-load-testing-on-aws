// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { http } from "msw";
import { ok } from "../../mocks/handlers";
import { ApiEndpoints } from "../../store/solutionApi";
import { MOCK_SERVER_URL, server } from "../server";
import { renderAppContent } from "../test-utils";
import { TestResultsTable } from "../../pages/scenarios/components/TestResultsTable";
import type { TableRow, TestRunDetails } from "../../pages/scenarios/types/testResults";
import { ViewMode } from "../../pages/scenarios/types/viewMode";

// --- Shared test data helpers ---

const makeLabelMetrics = (label: string, fail: number, succ: number) => ({
  avg_lt: "0.005",
  p0_0: "0.003",
  p99_0: "0.011",
  stdev_rt: "0.005",
  avg_ct: "0.003",
  label,
  concurrency: "1",
  p99_9: "0.021",
  fail,
  rc: fail > 0 ? [{ count: fail, code: "500" }] : [],
  succ,
  p100_0: "0.482",
  bytes: "1000000",
  p95_0: "0.007",
  avg_rt: "0.005",
  throughput: fail + succ,
  p90_0: "0.006",
  testDuration: "60",
  p50_0: "0.004",
});

const mockTestRun: TestRunDetails = {
  testRunId: "run-001",
  testId: "test-123",
  startTime: "2025-01-01 00:00:00",
  endTime: "2025-01-01 00:10:00",
  testDescription: "test",
  testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
  completeTasks: { "us-east-1": 1 },
  testType: "simple",
  status: "complete",
  succPercent: "100",
  results: {
    "us-east-1": {
      ...makeLabelMetrics("https://example.com", 5, 95),
      labels: [makeLabelMetrics("https://example.com", 5, 95)],
    },
    total: {
      ...makeLabelMetrics("https://example.com", 5, 95),
      labels: [makeLabelMetrics("https://example.com", 5, 95)],
    },
  },
};

function renderTable(overrides: Partial<Parameters<typeof TestResultsTable>[0]> = {}) {
  const props = {
    testRun: mockTestRun,
    baseline: undefined,
    selectedItems: [] as TableRow[],
    onSelectionChange: vi.fn(),
    displayMode: "actual" as const,
    viewMode: ViewMode.Overall,
    onViewModeChange: vi.fn(),
    ...overrides,
  };
  const result = render(<TestResultsTable {...props} />);
  return { wrapper: createWrapper(result.container), ...props };
}

// --- Component-level tests ---

describe("TestResultsTable", () => {
  test("renders table header with result count", () => {
    renderTable();
    expect(screen.getByText(/Test Run Results/)).toBeInTheDocument();
  });

  test("renders view mode segmented control", () => {
    const { wrapper } = renderTable();
    expect(wrapper.findSegmentedControl()).toBeTruthy();
  });

  test("renders table with data rows", () => {
    const { wrapper } = renderTable();
    expect(wrapper.findTable()!.findRows().length).toBeGreaterThan(0);
  });

  test("shows empty state when no test run provided", () => {
    renderTable({ testRun: undefined });
    expect(screen.getByText("No test results available")).toBeInTheDocument();
  });

  test("renders filter input", () => {
    const { wrapper } = renderTable();
    expect(wrapper.findTextFilter()).toBeTruthy();
  });

  test("calls onViewModeChange when segmented control changes", () => {
    const { wrapper, onViewModeChange } = renderTable();
    wrapper.findSegmentedControl()!.findSegments()[1].click();
    expect(onViewModeChange).toHaveBeenCalledWith(ViewMode.ByEndpoint);
  });
});

// --- Integration test via full page route ---

describe("TestResultsTable via TestRunDetailsPage", () => {
  test("renders table with 2 endpoint rows", async () => {
    const mockTestRunWith2Labels = {
      startTime: "2025-09-27 21:54:11",
      testDescription: "two endpoint test",
      testId: "test-2labels",
      endTime: "2025-09-27 21:56:20",
      testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
      completeTasks: { "us-east-1": 1 },
      testType: "simple",
      status: "complete",
      succPercent: "50.00",
      testRunId: "run-2labels",
      results: {
        total: {
          ...makeLabelMetrics("overall", 100, 900),
          labels: [
            makeLabelMetrics("/api/users", 10, 490),
            makeLabelMetrics("/api/orders", 90, 410),
          ],
        },
      },
      testScenario: {
        execution: [{ "ramp-up": "0m", "hold-for": "1m", scenario: "two endpoint test" }],
      },
    };

    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok(mockTestRunWith2Labels),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/baseline", () =>
        ok({ testId: "test-2labels", baselineId: null, message: "No baseline" }),
      ),
    );

    renderAppContent({ initialRoute: "/scenarios/test-2labels/testruns/run-2labels" });

    expect(await screen.findByText("/api/users")).toBeInTheDocument();
    expect(screen.getByText("/api/orders")).toBeInTheDocument();
  });
});
