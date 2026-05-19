// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen, within } from "@testing-library/react";
import { mockScenarioDetails } from "../../mocks/handlers";
import { TaskStatus } from "../../pages/scenarios/components/TaskStatus";
import { TestStatus } from "../../pages/scenarios/constants";

/** Clone mock with status set to RUNNING so the task progress panel is visible. */
const runningScenario = { ...mockScenarioDetails, status: TestStatus.RUNNING };

describe("TaskStatus", () => {
  it("renders region names in the task counts table", () => {
    render(<TaskStatus scenario_definition={runningScenario} />);

    // Region names appear in both the chart and the table — use getAllByText
    expect(screen.getAllByText("us-east-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("us-east-2").length).toBeGreaterThanOrEqual(1);
  });

  it("renders task counts in the table with correct values from computeTaskStatusItem", () => {
    render(<TaskStatus scenario_definition={runningScenario} />);

    // mockScenarioDetails:
    //   us-east-1: running=1, pending=0, taskCount=100 => provisioning=99
    //   us-east-2: running=0, pending=1, taskCount=800 => provisioning=799
    // Unique counts that only appear once in the table
    const table = screen.getByRole("table");
    expect(within(table).getByText("99")).toBeInTheDocument();
    expect(within(table).getByText("799")).toBeInTheDocument();
  });

  it("hides task progress panel when status is past running", () => {
    const completedScenario = { ...mockScenarioDetails, status: TestStatus.COMPLETE };
    render(<TaskStatus scenario_definition={completedScenario} />);

    expect(screen.queryByText("Task Status")).not.toBeInTheDocument();
  });

  it("renders chart no-data placeholders when no PubSub data", () => {
    render(<TaskStatus scenario_definition={runningScenario} />);

    expect(screen.getAllByText("There is no data available.")).toHaveLength(4);
  });
});
