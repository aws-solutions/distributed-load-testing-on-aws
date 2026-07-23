// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestRunsDateFilter } from "../../pages/scenarios/components/TestRunsDateFilter";

describe("TestRunsDateFilter", () => {
  it("renders the date range picker", () => {
    render(<TestRunsDateFilter dateFilter={null} onChange={vi.fn()} />);
    expect(screen.getByText("Filter by date range")).toBeInTheDocument();
  });

  it("renders with a relative date value", () => {
    const dateFilter = { type: "relative", amount: 7, unit: "day" };
    render(<TestRunsDateFilter dateFilter={dateFilter} onChange={vi.fn()} />);
    // Should render with the value set
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
  });

  it("renders with null value showing placeholder", () => {
    render(<TestRunsDateFilter dateFilter={null} onChange={vi.fn()} />);
    expect(screen.getByText("Filter by date range")).toBeInTheDocument();
  });
});
