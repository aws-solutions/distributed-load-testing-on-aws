// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import { TaskStatus } from "../../pages/scenarios/components/TaskStatus";
import { mockScenarioDetails } from "../../mocks/handlers";

describe("TaskStatus", () => {
  it("renders task status table with correct data", () => {
    render(<TaskStatus scenario_definition={mockScenarioDetails} />);

    // Check table headers
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByText("Task Counts")).toBeInTheDocument();
    expect(screen.getByText("Concurrency")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Provisioning")).toBeInTheDocument();
  });

  it("displays correct task counts and concurrency from testTaskConfigs", () => {
    render(<TaskStatus scenario_definition={mockScenarioDetails} />);

    // Check us-east-1 data
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument(); // taskCount
    expect(screen.getByText("10")).toBeInTheDocument(); // concurrency

    // Check us-east-2 data
    expect(screen.getByText("us-east-2")).toBeInTheDocument();
    expect(screen.getByText("800")).toBeInTheDocument(); // taskCount
    expect(screen.getByText("30")).toBeInTheDocument(); // concurrency
  });

  it("displays correct task status counts", () => {
    render(<TaskStatus scenario_definition={mockScenarioDetails} />);

    const rows = screen.getAllByRole("row");

    // us-east-1 row: 1 running, 0 pending, 0 provisioning
    expect(rows[1]).toHaveTextContent("us-east-1");
    expect(rows[1]).toHaveTextContent("1"); // running
    expect(rows[1]).toHaveTextContent("0"); // pending
    expect(rows[1]).toHaveTextContent("0"); // provisioning

    // us-east-2 row: 0 running, 1 pending, 1 provisioning
    expect(rows[2]).toHaveTextContent("us-east-2");
    expect(rows[2]).toHaveTextContent("0"); // running
    expect(rows[2]).toHaveTextContent("1"); // pending
    expect(rows[2]).toHaveTextContent("1"); // provisioning
  });
});
