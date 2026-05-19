// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestRunsBaselineContainer } from "../../pages/scenarios/components/TestRunsBaselineContainer";

describe("TestRunsBaselineContainer", () => {
  it("renders nothing when baselineTestRun is null", () => {
    const { container } = render(
      <TestRunsBaselineContainer baselineTestRun={null} onRemoveBaseline={vi.fn()} isRemovingBaseline={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders baseline info and remove button when testRun is provided", () => {
    render(
      <TestRunsBaselineContainer
        baselineTestRun={{ testRunId: "run-1", startTime: "2025-09-27 21:54:11" } as any}
        onRemoveBaseline={vi.fn()}
        isRemovingBaseline={false}
      />
    );
    expect(screen.getByText("Baseline")).toBeInTheDocument();
    expect(screen.getByText("Remove Baseline")).toBeInTheDocument();
  });
});
