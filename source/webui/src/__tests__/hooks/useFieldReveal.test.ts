// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFieldReveal } from "../../pages/scenarios/hooks/useFieldReveal";

describe("useFieldReveal", () => {
  it("does not reveal an untouched field before submit", () => {
    const { result } = renderHook(() => useFieldReveal(false));
    expect(result.current.isRevealed("a")).toBe(false);
  });

  it("reveals a field once it is touched (blurred), independently of others", () => {
    const { result } = renderHook(() => useFieldReveal(false));
    act(() => result.current.markTouched("a"));
    expect(result.current.isRevealed("a")).toBe(true);
    expect(result.current.isRevealed("b")).toBe(false);
  });

  it("reveals every field once a submit is attempted", () => {
    const { result } = renderHook(() => useFieldReveal(true));
    expect(result.current.isRevealed("anything")).toBe(true);
  });

  it("resetTouched clears every touched field", () => {
    const { result } = renderHook(() => useFieldReveal(false));
    act(() => {
      result.current.markTouched("a");
      result.current.markTouched("b");
    });
    act(() => result.current.resetTouched());
    expect(result.current.isRevealed("a")).toBe(false);
    expect(result.current.isRevealed("b")).toBe(false);
  });
});
