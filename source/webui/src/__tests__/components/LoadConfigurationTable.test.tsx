// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadConfigurationTable } from "../../pages/scenarios/components/LoadConfigurationTable";

const configs = [
  { region: "us-west-2", taskCount: 2, concurrency: 5 },
  { region: "eu-west-1", taskCount: 1, concurrency: 10 },
];

describe("LoadConfigurationTable", () => {
  describe("standard mode", () => {
    it("shows the concurrency column and a virtual-users summary (VUs = tasks × concurrency)", () => {
      render(<LoadConfigurationTable configs={configs} rampUp="1m" holdFor="5m" emptyText="none" />);
      expect(screen.getByText("Concurrent Users")).toBeInTheDocument();
      // Total VUs = 2*5 + 1*10 = 20
      expect(screen.getByText(/1m ramp-up · 5m hold · 20 virtual users/)).toBeInTheDocument();
    });

    // Naming only Native would leave existing customers' runs unlabeled, with no
    // signal that Standard is the mode they have been on since before v4.3.0.
    it("names Standard in the summary", () => {
      render(<LoadConfigurationTable configs={configs} rampUp="1m" holdFor="5m" emptyText="none" />);
      expect(screen.getByText(/^Standard · /)).toBeInTheDocument();
    });

    it("appends the healthy-threshold to the summary when provided", () => {
      render(<LoadConfigurationTable configs={configs} rampUp="1m" holdFor="5m" threshold={90} emptyText="none" />);
      expect(screen.getByText(/90% healthy threshold/)).toBeInTheDocument();
    });
  });

  describe("native mode", () => {
    const nativeRunMode = { maxTestDurationSeconds: 1800 };

    it("drops the concurrency / VU columns and summarizes by max duration", () => {
      render(
        <LoadConfigurationTable configs={configs} nativeRunMode={nativeRunMode} rampUp="1m" holdFor="5m" emptyText="none" />,
      );
      expect(screen.getByText(/Native Mode/)).toBeInTheDocument();
      expect(screen.getByText(/max duration/)).toBeInTheDocument();
      // Concurrency-based columns and the VU summary are misleading for native runs, so they are hidden.
      expect(screen.queryByText("Concurrent Users")).not.toBeInTheDocument();
      expect(screen.queryByText(/virtual users/)).not.toBeInTheDocument();
    });
  });

  it("renders the empty text when there are no regions", () => {
    render(<LoadConfigurationTable configs={[]} rampUp="1m" holdFor="5m" emptyText="No regions configured" />);
    expect(screen.getByText("No regions configured")).toBeInTheDocument();
  });
});
