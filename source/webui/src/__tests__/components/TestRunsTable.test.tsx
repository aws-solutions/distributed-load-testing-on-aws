// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestRunsTable } from "../../pages/scenarios/components/TestRunsTable";

const baseProps = {
  testRuns: [
    { testRunId: "run-1", startTime: "2025-09-27 21:54:11", status: "complete" as const },
    { testRunId: "run-2", startTime: "2025-09-28 10:00:00", status: "running" as const },
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
});
