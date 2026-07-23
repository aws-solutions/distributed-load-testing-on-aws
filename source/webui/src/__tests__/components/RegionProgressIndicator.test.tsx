// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegionProgressIndicator, buildPercentageSeries } from "../../pages/scenarios/components/RegionProgressIndicator";
import type { TaskStatusItem } from "../../pages/scenarios/types";

const mockItems: TaskStatusItem[] = [
  { region: "us-east-1", running: 8, pending: 1, provisioning: 1, stopped: 0, desired: 10, concurrency: 100, regionStatus: "Ready" },
  { region: "eu-west-1", running: 5, pending: 0, provisioning: 0, stopped: 5, desired: 10, concurrency: 50, regionStatus: "Degraded" },
];

describe("RegionProgressIndicator", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(<RegionProgressIndicator items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the chart and table when items are provided", () => {
    render(<RegionProgressIndicator items={mockItems} />);
    expect(screen.getByText("Task counts")).toBeInTheDocument();
    expect(screen.getAllByText("us-east-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("eu-west-1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders region column and state columns in the table", () => {
    render(<RegionProgressIndicator items={mockItems} />);
    expect(screen.getByText("Region")).toBeInTheDocument();
    // State columns may appear multiple times (chart legend + table header)
    expect(screen.getAllByText("Running").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Provisioning").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Stopped").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Desired").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the chart with aria label", () => {
    render(<RegionProgressIndicator items={mockItems} />);
    expect(screen.getByLabelText("Task provisioning progress by region")).toBeInTheDocument();
  });
});

describe("buildPercentageSeries", () => {
  it("returns series for each state", () => {
    const series = buildPercentageSeries(mockItems);
    expect(series).toHaveLength(4);
    expect(series.map((s) => s.title)).toEqual(["Running", "Pending", "Provisioning", "Stopped"]);
  });

  it("calculates percentage correctly", () => {
    const series = buildPercentageSeries(mockItems);
    const runningSeries = series.find((s) => s.title === "Running")!;
    // us-east-1: 8/10 = 80%, eu-west-1: 5/10 = 50%
    expect(runningSeries.data[0].y).toBe(80);
    expect(runningSeries.data[1].y).toBe(50);
  });

  it("caps percentage at 100", () => {
    const items: TaskStatusItem[] = [
      { region: "us-east-1", running: 15, pending: 0, provisioning: 0, stopped: 0, desired: 10, concurrency: 10, regionStatus: "Ready" },
    ];
    const series = buildPercentageSeries(items);
    const runningSeries = series.find((s) => s.title === "Running")!;
    expect(runningSeries.data[0].y).toBe(100);
  });

  it("returns 0% when desired is 0", () => {
    const items: TaskStatusItem[] = [
      { region: "us-east-1", running: 5, pending: 0, provisioning: 0, stopped: 0, desired: 0, concurrency: 0, regionStatus: "Ready" },
    ];
    const series = buildPercentageSeries(items);
    const runningSeries = series.find((s) => s.title === "Running")!;
    expect(runningSeries.data[0].y).toBe(0);
  });

  it("assigns correct colors to each series", () => {
    const series = buildPercentageSeries(mockItems);
    expect(series[0].color).toBe("#1d8102"); // Running - green
    expect(series[1].color).toBe("#0073bb"); // Pending - blue
    expect(series[2].color).toBe("#e07b12"); // Provisioning - orange
    expect(series[3].color).toBe("#d13212"); // Stopped - red
  });
});
