// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestResultsErrors } from "../../pages/scenarios/components/TestResultsErrors";
import { generateMockTestRunDetails } from "../test-data-factory";

describe("TestResultsErrors", () => {
  it("shows info message when testRunDetails is null", () => {
    render(<TestResultsErrors testRunDetails={null} />);
    expect(screen.getByText("No test run data available")).toBeInTheDocument();
  });

  it("renders error table with data from test run", () => {
    const testRunDetails = generateMockTestRunDetails();
    render(<TestResultsErrors testRunDetails={testRunDetails} />);
    expect(screen.getByText("HTTP Errors")).toBeInTheDocument();
    expect(screen.getByText("403")).toBeInTheDocument();
  });
});
