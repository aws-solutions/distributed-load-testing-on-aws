// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestResultsErrors } from "../../pages/scenarios/components/TestResultsErrors";

const mockTestRunWithErrors = {
  testRunId: "run-001",
  testId: "test-123",
  startTime: "2025-01-15 10:00:00",
  endTime: "2025-01-15 11:00:00",
  status: "complete" as const,
  results: {
    total: {
      rc: [
        { code: "403", count: 500 },
        { code: "500", count: 50 },
      ],
      labels: [
        {
          label: "https://example.com/api/users",
          rc: [
            { code: "403", count: 300 },
            { code: "404", count: 20 },
          ],
        },
        {
          label: "https://example.com/api/orders",
          rc: [{ code: "500", count: 50 }],
        },
      ],
    },
  },
} as any;

describe("TestResultsErrors", () => {
  it("renders 'no data available' when testRunDetails is null", () => {
    render(<TestResultsErrors testRunDetails={null} />);
    expect(screen.getByText("No test run data available")).toBeInTheDocument();
  });

  it("renders 'no data available' when results is missing", () => {
    render(<TestResultsErrors testRunDetails={{ testRunId: "r1" } as any} />);
    expect(screen.getByText("No test run data available")).toBeInTheDocument();
  });

  it("renders 'no errors found' when results has no error codes", () => {
    const noErrors = {
      results: { total: { rc: [], labels: [] } },
    } as any;
    render(<TestResultsErrors testRunDetails={noErrors} />);
    expect(screen.getByText("No errors found in this test run")).toBeInTheDocument();
  });

  it("renders error table with overall view by default", () => {
    render(<TestResultsErrors testRunDetails={mockTestRunWithErrors} />);
    expect(screen.getByText("HTTP Errors")).toBeInTheDocument();
    expect(screen.getByText("403")).toBeInTheDocument();
    // "500" appears as both code and count (500 count for 403), use getAllByText
    expect(screen.getAllByText("500").length).toBeGreaterThanOrEqual(1);
  });

  it("shows error count header", () => {
    render(<TestResultsErrors testRunDetails={mockTestRunWithErrors} />);
    // Overall view: shows the 2 overall errors (403 and 500 from rc)
    expect(screen.getByText(/\(\d+\)/)).toBeInTheDocument();
  });

  it("renders segmented controls for error type and view mode", () => {
    render(<TestResultsErrors testRunDetails={mockTestRunWithErrors} />);
    // Check view mode control - "Overall" appears in table too, so use getAllByText
    expect(screen.getAllByText("Overall").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("By Endpoint")).toBeInTheDocument();
  });

  it("renders table column headers", () => {
    render(<TestResultsErrors testRunDetails={mockTestRunWithErrors} />);
    expect(screen.getByText("Test Label")).toBeInTheDocument();
    expect(screen.getByText("Error Code")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();
  });

  it("handles results with no total key", () => {
    const noTotal = { results: { "us-east-1": { rc: [{ code: "500", count: 5 }] } } } as any;
    render(<TestResultsErrors testRunDetails={noTotal} />);
    expect(screen.getByText("No errors found in this test run")).toBeInTheDocument();
  });
});
