// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInView } from "../../pages/scenarios/hooks/useInView";

/** Renders the hook against a real element so the observer has a node to watch. */
function Probe() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return <div ref={ref}>{inView ? "in-view" : "not-in-view"}</div>;
}

describe("useInView", () => {
  describe("with IntersectionObserver available", () => {
    let trigger: (entries: Array<Partial<IntersectionObserverEntry>>) => void;
    const observe = vi.fn();
    const disconnect = vi.fn();

    beforeEach(() => {
      class MockIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          trigger = (entries) => callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
        }
        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
      }
      vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it("starts out of view and observes the element", () => {
      render(<Probe />);
      expect(screen.getByText("not-in-view")).toBeInTheDocument();
      expect(observe).toHaveBeenCalledTimes(1);
    });

    it("flips to in view and disconnects once the element intersects", () => {
      render(<Probe />);
      act(() => trigger([{ isIntersecting: true }]));
      expect(screen.getByText("in-view")).toBeInTheDocument();
      expect(disconnect).toHaveBeenCalled();
    });

    it("stays out of view while the element is not intersecting", () => {
      render(<Probe />);
      act(() => trigger([{ isIntersecting: false }]));
      expect(screen.getByText("not-in-view")).toBeInTheDocument();
    });
  });

  it("falls back to in view when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(screen.getByText("in-view")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
