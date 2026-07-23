// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestLifecycleSteps } from "../../pages/scenarios/components/TestLifecycleSteps";
import { TestStatus } from "../../pages/scenarios/constants";

describe("TestLifecycleSteps", () => {
  it("renders all 5 lifecycle phase labels", () => {
    render(<TestLifecycleSteps status={TestStatus.QUEUED} />);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Provisioning")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("shows queued as loading when status is queued", () => {
    render(<TestLifecycleSteps status={TestStatus.QUEUED} />);
    expect(screen.getByLabelText("Test lifecycle progress")).toBeInTheDocument();
  });

  it("shows provisioning as current when status is provisioning", () => {
    render(<TestLifecycleSteps status={TestStatus.PROVISIONING} />);
    expect(screen.getByText("Provisioning")).toBeInTheDocument();
  });

  it("shows running as current when status is running", () => {
    render(<TestLifecycleSteps status={TestStatus.RUNNING} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows processing as current when status is parsing results", () => {
    render(<TestLifecycleSteps status={TestStatus.PARSING_RESULTS} />);
    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("shows processing as current when status is cleaning up", () => {
    render(<TestLifecycleSteps status={TestStatus.CLEANING_UP} />);
    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("shows processing as current when status is cancelling", () => {
    render(<TestLifecycleSteps status={TestStatus.CANCELLING} />);
    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("shows all steps as success when status is complete", () => {
    render(<TestLifecycleSteps status={TestStatus.COMPLETE} />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("shows Cancelled label when status is cancelled", () => {
    render(<TestLifecycleSteps status={TestStatus.CANCELLED} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("shows Failed label when status is failed", () => {
    render(<TestLifecycleSteps status={TestStatus.FAILED} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
