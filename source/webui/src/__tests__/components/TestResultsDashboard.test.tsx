// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestRunDashboard } from "../../pages/scenarios/components/TestResultsDashboard";
import { ViewMode } from "../../pages/scenarios/types/viewMode";
import { generateMockTestRunDetails } from "../test-data-factory";

describe("TestRunDashboard", () => {
  it("shows empty state when no row is selected", () => {
    render(
      <TestRunDashboard selectedRow={null} testRunDetails={null} viewMode={ViewMode.Overall} />
    );
    expect(screen.getByText("Select a test result row to view detailed metrics")).toBeInTheDocument();
  });

  it("renders dashboard metrics when data is provided", () => {
    const testRunDetails = generateMockTestRunDetails();
    const selectedRow = {
      id: "total-overall",
      run: "total",
      region: "total",
      testLabel: "Overall",
      requests: 11973,
      success: 0,
      successRate: 0,
      avgRespTime: 0.00473,
      p95RespTime: 0.007,
      errors: 11973,
      requestsPerSecond: 11973,
      avgLatency: 0.00467,
      avgConnectionTime: 0.00347,
      avgBandwidth: 15097953,
      p0RespTime: 0.003,
      p50RespTime: 0.004,
      p90RespTime: 0.006,
      p99RespTime: 0.011,
      p99_9RespTime: 0.021,
      p100RespTime: 0.482,
    };
    render(
      <TestRunDashboard selectedRow={selectedRow} testRunDetails={testRunDetails} viewMode={ViewMode.Overall} />
    );
    expect(screen.getByText("Test Run Metrics Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Avg Response Time")).toBeInTheDocument();
  });
});
