// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollToFirstError } from "../../pages/scenarios/utils/scrollToFirstError";

describe("scrollToFirstError", () => {
  beforeEach(() => {
    // jsdom doesn't implement these; stub so the helper can call them.
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("returns false when there is no invalid control and no fallback section", () => {
    document.body.innerHTML = `<div data-section-id="a"><input /></div>`;
    expect(scrollToFirstError()).toBe(false);
  });

  it("focuses the first invalid control", () => {
    document.body.innerHTML = `
      <div data-section-id="section-1"><input id="ok" /></div>
      <div data-section-id="section-2">
        <input id="bad" aria-invalid="true" />
      </div>`;
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

    expect(scrollToFirstError()).toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("bad");
  });

  it("targets the first invalid control in DOM order", () => {
    document.body.innerHTML = `
      <div data-section-id="first"><input id="a" aria-invalid="true" /></div>
      <div data-section-id="second"><input id="b" aria-invalid="true" /></div>`;
    expect(scrollToFirstError()).toBe(true);
    expect(document.activeElement?.id).toBe("a");
  });

  it("falls back to scrolling the owning section when no invalid control exists", () => {
    document.body.innerHTML = `
      <div data-section-id="multi-region"><span>Please select at least one region</span></div>`;
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

    expect(scrollToFirstError("multi-region")).toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("prefers an invalid control over the fallback section", () => {
    document.body.innerHTML = `
      <div data-section-id="multi-region"><span>section error</span></div>
      <div data-section-id="test-duration"><input id="dur" aria-invalid="true" /></div>`;
    expect(scrollToFirstError("multi-region")).toBe(true);
    // The focusable invalid control wins over the fallback section.
    expect(document.activeElement?.id).toBe("dur");
  });
});
