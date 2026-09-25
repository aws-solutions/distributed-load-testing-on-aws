// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @fileoverview Unit tests for the shared page-state components:
 * PageLoadingState, PageErrorState, and EmptyState.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageLoadingState, PageErrorState, EmptyState } from "../../components/common";

describe("PageLoadingState", () => {
  it("renders the page title as a heading and the default loading message", () => {
    render(<PageLoadingState title="Test Scenarios" />);
    expect(screen.getByRole("heading", { level: 1, name: "Test Scenarios" })).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders a custom loading message", () => {
    render(<PageLoadingState title="Test Run Details" message="Loading test run details..." />);
    expect(screen.getByText("Loading test run details...")).toBeInTheDocument();
  });

  it("renders an optional header description", () => {
    render(<PageLoadingState title="Create Test Scenario" description="Configure the settings for your load test" />);
    expect(screen.getByText("Configure the settings for your load test")).toBeInTheDocument();
  });
});

describe("PageErrorState", () => {
  it("renders the page title heading and the message", () => {
    render(<PageErrorState title="Test Scenarios" message="Failed to load test scenarios" />);
    expect(screen.getByRole("heading", { level: 1, name: "Test Scenarios" })).toBeInTheDocument();
    expect(screen.getByText("Failed to load test scenarios")).toBeInTheDocument();
  });

  it("renders no action buttons when actions are omitted", () => {
    render(<PageErrorState title="Test Scenarios" message="Something went wrong" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders and fires multiple actions", async () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    render(
      <PageErrorState
        title="Scenario Details"
        message="Failed to load scenario details"
        actions={[
          { label: "Back to Scenarios", onClick: onBack },
          { label: "Retry", onClick: onRetry },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await userEvent.click(screen.getByRole("button", { name: "Back to Scenarios" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("supports the warning alert type", () => {
    render(
      <PageErrorState title="Scenario Details" alertType="warning" message="Unable to load live test data" />,
    );
    expect(screen.getByText("Unable to load live test data")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the title and message without page chrome (no heading)", () => {
    render(<EmptyState title="No test scenarios" message="Create your first test scenario to get started." />);
    expect(screen.getByText("No test scenarios")).toBeInTheDocument();
    expect(screen.getByText("Create your first test scenario to get started.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders and fires the primary action", async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No test scenarios"
        message="Create your first test scenario to get started."
        primaryAction={{ label: "Create scenario", onClick }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Create scenario" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
