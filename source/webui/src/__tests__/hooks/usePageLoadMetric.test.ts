// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { renderHook } from "@testing-library/react";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";
import { beforeEach } from 'vitest'

// Mock the metric sender so no real HTTP calls are made.
const mockSendConsoleMetric = vi.fn();
vi.mock("../../utils/consoleMetrics", () => ({
  sendConsoleMetric: (...args: unknown[]) => mockSendConsoleMetric(...args),
}));

beforeEach(() => mockSendConsoleMetric.mockClear());

describe("usePageLoadMetric", () => {
  it("does not emit PageDataReady when dataReady is false (error-gating)", () => {
    // GIVEN dataReady stays false (simulates a query that errored)
    renderHook(() => usePageLoadMetric("TestPage", { dataReady: false }));

    // THEN PageInitialLoad fires but PageDataReady does not
    expect(mockSendConsoleMetric).toHaveBeenCalledWith(
      "PageInitialLoad",
      expect.objectContaining({ Page: "TestPage" }),
    );
    expect(mockSendConsoleMetric).not.toHaveBeenCalledWith(
      "PageDataReady",
      expect.anything(),
    );
  });

  it("emits PageDataReady once dataReady flips to true", () => {
    // GIVEN dataReady starts false then becomes true
    const { rerender } = renderHook(
      ({ ready }) => usePageLoadMetric("TestPage", { dataReady: ready }),
      { initialProps: { ready: false } },
    );

    // Sanity: only PageInitialLoad so far
    expect(mockSendConsoleMetric).toHaveBeenCalledTimes(1);

    // WHEN data finishes loading successfully
    rerender({ ready: true });

    // THEN PageDataReady is emitted
    expect(mockSendConsoleMetric).toHaveBeenCalledWith(
      "PageDataReady",
      expect.objectContaining({ Page: "TestPage" }),
    );
  });
});
