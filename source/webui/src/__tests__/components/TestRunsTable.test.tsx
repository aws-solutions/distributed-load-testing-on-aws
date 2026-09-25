// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TestRunsTable } from "../../pages/scenarios/components/TestRunsTable";
import { TestStatus } from "@amzn/dlt-common/validation";

const baseProps = {
  testRuns: [
    { testRunId: "run-1", startTime: "2025-09-27 21:54:11", status: TestStatus.COMPLETE },
    { testRunId: "run-failed", startTime: "2025-09-27 22:00:00", status: TestStatus.FAILED },
    { testRunId: "run-cancelled", startTime: "2025-09-27 23:00:00", status: TestStatus.CANCELLED },
    { testRunId: "run-2", startTime: "2025-09-28 10:00:00", status: TestStatus.RUNNING },
    { testRunId: "run-unknown", startTime: "2025-09-28 11:00:00", status: "future status" as TestStatus },
  ],
  columns: [{ id: "testRun", header: "Test Run", cell: (item: any) => item.testRunId }],
  allColumns: [{ id: "testRun", header: "Test Run", cell: (item: any) => item.testRunId }],
  preferences: { pageSize: 20, wrapLines: false, contentDisplay: [{ id: "testRun", visible: true }] },
  onPreferencesChange: vi.fn(),
  onSetBaseline: vi.fn(),
  isSettingBaseline: false,
  isLoadingMore: false,
  isLoading: false,
  filter: <div>filter</div>,
};

describe("TestRunsTable", () => {
  it("renders table with test runs", () => {
    render(<TestRunsTable {...baseProps} />);
    expect(screen.getByText("run-1")).toBeInTheDocument();
    expect(screen.getByText("run-2")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<TestRunsTable {...baseProps} isLoading={true} testRuns={[]} />);
    expect(screen.getByText("Loading test runs...")).toBeInTheDocument();
  });

  it("disables selection for non-terminal runs", () => {
    render(<TestRunsTable {...baseProps} />);

    expect(screen.getByRole("checkbox", { name: "run-1" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "run-failed" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "run-cancelled" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "run-2" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "run-unknown" })).toBeDisabled();
  });

  it("enables Delete only for terminal selections", () => {
    render(<TestRunsTable {...baseProps} onDeleteTestRuns={vi.fn()} />);

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "run-1" }));
    expect(deleteButton).toBeEnabled();
  });
});
