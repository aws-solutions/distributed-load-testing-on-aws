// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyNativeModeInput, useFormData } from "../../pages/scenarios/hooks/useFormData";

describe("useFormData native mode", () => {
  it("defaults the safety duration to 4 hours", () => {
    const { result } = renderHook(() => useFormData());

    expect(result.current.formData.nativeMode).toEqual(createEmptyNativeModeInput());
    expect(result.current.formData.nativeMode.maxDuration).toEqual({ value: "4", unit: "hours" });
  });

  it("updates the safety duration via updateNativeMode", () => {
    const { result } = renderHook(() => useFormData());

    act(() => result.current.updateNativeMode({ maxDuration: { value: "30", unit: "minutes" } }));

    expect(result.current.formData.nativeMode).toEqual({ maxDuration: { value: "30", unit: "minutes" } });
  });

  it("resets native mode to the default on resetFormData", () => {
    const { result } = renderHook(() => useFormData());

    act(() => result.current.updateNativeMode({ maxDuration: { value: "10", unit: "seconds" } }));
    act(() => result.current.resetFormData());

    expect(result.current.formData.nativeMode).toEqual(createEmptyNativeModeInput());
  });
});
