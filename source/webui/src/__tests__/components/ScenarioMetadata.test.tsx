// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioMetadata } from "../../pages/scenarios/components/ScenarioMetadata";
import { generateMockTestRunDetails } from "../test-data-factory";

describe("ScenarioMetadata", () => {
  const testRun = generateMockTestRunDetails();

  it("renders test scenario and run IDs", () => {
    render(<ScenarioMetadata testRun={testRun} testId="MockTestId123" testRunId="MockRunId456" />);
    expect(screen.getByText("MockTestId123")).toBeInTheDocument();
    expect(screen.getByText("MockRunId456")).toBeInTheDocument();
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByText("Task Count")).toBeInTheDocument();
  });

  it("renders start and end timestamps", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Started At")).toBeInTheDocument();
    expect(screen.getByText("Ended At")).toBeInTheDocument();
  });

  it("renders ramp up and hold for values", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Ramp Up")).toBeInTheDocument();
    expect(screen.getByText("Hold For")).toBeInTheDocument();
    expect(screen.getByText("0m")).toBeInTheDocument();
    expect(screen.getByText("1m")).toBeInTheDocument();
  });

  it("renders scenario name from execution config", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("renders description", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Description")).toBeInTheDocument();
    // "basic endpoint test" appears in both name and description
    expect(screen.getAllByText("basic endpoint test").length).toBeGreaterThanOrEqual(1);
  });

  it("handles missing testScenario execution gracefully", () => {
    const emptyRun = { ...testRun, testScenario: {} };
    render(<ScenarioMetadata testRun={emptyRun} testId="t1" testRunId="r1" />);
    // Should render '-' for missing values
    const dashes = screen.getAllByText("-");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("handles missing testTaskConfigs gracefully", () => {
    const noConfigs = { ...testRun, testTaskConfigs: undefined };
    render(<ScenarioMetadata testRun={noConfigs} testId="t1" testRunId="r1" />);
    expect(screen.getByText("No regional configuration available")).toBeInTheDocument();
  });

  it("renders copy buttons for IDs", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByLabelText("Copy test scenario ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy test run ID")).toBeInTheDocument();
  });

  it("renders the Concurrency column in the table", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Concurrency")).toBeInTheDocument();
  });
});
