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
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("renders the Run Overview and Load Configuration sections", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Run Overview")).toBeInTheDocument();
    expect(screen.getByText("Load Configuration")).toBeInTheDocument();
  });

  it("renders start and end timestamps", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("renders ramp-up and hold values in the configuration summary", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    // Ramp-up and hold are summarized in the Load Configuration section description.
    expect(screen.getByText(/ramp-up/)).toBeInTheDocument();
    expect(screen.getByText(/hold/)).toBeInTheDocument();
  });

  it("renders total VUs in the configuration summary", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText(/virtual users/)).toBeInTheDocument();
    expect(screen.getByText("Total VUs")).toBeInTheDocument();
  });

  it("handles missing testScenario execution gracefully", () => {
    const emptyRun = { ...testRun, testScenario: {} };
    render(<ScenarioMetadata testRun={emptyRun} testId="t1" testRunId="r1" />);
    // Missing ramp-up/hold fall back to '-' in the summary description.
    expect(screen.getByText(/- ramp-up · - hold/)).toBeInTheDocument();
  });

  it("handles missing testTaskConfigs gracefully", () => {
    const noConfigs = { ...testRun, testTaskConfigs: undefined };
    render(<ScenarioMetadata testRun={noConfigs} testId="t1" testRunId="r1" />);
    expect(screen.getByText("No regional configuration available")).toBeInTheDocument();
  });

  it("renders copy buttons for IDs", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByLabelText("Copy Scenario ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy Test Run ID")).toBeInTheDocument();
  });

  it("renders the Concurrent Users column in the table", () => {
    render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
    expect(screen.getByText("Concurrent Users")).toBeInTheDocument();
  });

  // Native-ness is the presence of nativeRunMode, matching the API's own
  // semantics — there is no boolean flag to read.
  describe("native mode", () => {
    const nativeRun = { ...testRun, nativeRunMode: { maxTestDurationSeconds: 1800 } };

    it("summarizes a native run by max duration instead of ramp-up/hold", () => {
      render(<ScenarioMetadata testRun={nativeRun} testId="t1" testRunId="r1" />);
      // The Load Configuration header summarizes native runs as duration-driven.
      expect(screen.getByText(/Native Mode/)).toBeInTheDocument();
      expect(screen.getByText(/30 minutes max duration/)).toBeInTheDocument();
      expect(screen.queryByText(/ramp-up/)).not.toBeInTheDocument();
    });

    // Native runs have no per-user concurrency (the payload sends a placeholder
    // of 1), so the concurrency / VU columns would be actively misleading.
    it("hides the Concurrent Users and Total VUs columns", () => {
      render(<ScenarioMetadata testRun={nativeRun} testId="t1" testRunId="r1" />);
      expect(screen.queryByText("Concurrent Users")).not.toBeInTheDocument();
      expect(screen.queryByText("Total VUs")).not.toBeInTheDocument();
      expect(screen.getByText("Tasks")).toBeInTheDocument();
    });

    // A run without nativeRunMode is a standard run: ramp-up/hold summary, VUs shown.
    it("treats a run without nativeRunMode as a standard run", () => {
      render(<ScenarioMetadata testRun={testRun} testId="t1" testRunId="r1" />);
      expect(screen.getByText(/ramp-up/)).toBeInTheDocument();
      expect(screen.queryByText(/max duration/)).not.toBeInTheDocument();
      expect(screen.getByText("Concurrent Users")).toBeInTheDocument();
    });

    it("shows '-' rather than a wrong duration when nativeRunMode carries none", () => {
      const noDuration = { ...testRun, nativeRunMode: {} as { maxTestDurationSeconds: number } };
      render(<ScenarioMetadata testRun={noDuration} testId="t1" testRunId="r1" />);
      expect(screen.getByText(/- max duration/)).toBeInTheDocument();
    });
  });
});
