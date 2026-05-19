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
});
