// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTagManagement } from "../../pages/scenarios/hooks/useTagManagement";
import type { FormData } from "../../pages/scenarios/types";

describe("useTagManagement", () => {
  const baseFormData = { tags: [] } as unknown as FormData;

  it("initializes with empty newTag and no error", () => {
    const updateFormData = vi.fn();
    const { result } = renderHook(() => useTagManagement(baseFormData, updateFormData));

    expect(result.current.newTag).toBe("");
    expect(result.current.tagError).toBe("");
  });

  it("adds a tag when addTag is called with valid input", () => {
    const updateFormData = vi.fn();
    const { result } = renderHook(() => useTagManagement(baseFormData, updateFormData));

    act(() => {
      result.current.setNewTag("my-tag");
    });
    act(() => {
      result.current.addTag();
    });

    expect(updateFormData).toHaveBeenCalledWith({
      tags: [{ label: "my-tag", dismissLabel: "Remove my-tag tag" }],
    });
    expect(result.current.newTag).toBe("");
    expect(result.current.tagError).toBe("");
  });

  it("trims whitespace from tag names", () => {
    const updateFormData = vi.fn();
    const { result } = renderHook(() => useTagManagement(baseFormData, updateFormData));

    act(() => {
      result.current.setNewTag("  spaced  ");
    });
    act(() => {
      result.current.addTag();
    });

    expect(updateFormData).toHaveBeenCalledWith({
      tags: [{ label: "spaced", dismissLabel: "Remove spaced tag" }],
    });
  });

  it("does nothing when addTag is called with empty string", () => {
    const updateFormData = vi.fn();
    const { result } = renderHook(() => useTagManagement(baseFormData, updateFormData));

    act(() => {
      result.current.setNewTag("");
    });
    act(() => {
      result.current.addTag();
    });

    expect(updateFormData).not.toHaveBeenCalled();
    expect(result.current.tagError).toBe("");
  });

  it("shows error when tag already exists (case-insensitive)", () => {
    const existingTags = { tags: [{ label: "Existing", dismissLabel: "Remove Existing tag" }] } as unknown as FormData;
    const updateFormData = vi.fn();
    const { result } = renderHook(() => useTagManagement(existingTags, updateFormData));

    act(() => {
      result.current.setNewTag("existing");
    });
    act(() => {
      result.current.addTag();
    });

    expect(updateFormData).not.toHaveBeenCalled();
    expect(result.current.tagError).toBe("This tag already exists.");
  });

  it("shows error when maximum 5 tags reached", () => {
    const fullTags = {
      tags: Array.from({ length: 5 }, (_, i) => ({ label: `tag${i}`, dismissLabel: `Remove tag${i} tag` })),
    } as unknown as FormData;
    const updateFormData = vi.fn();
    const { result } = renderHook(() => useTagManagement(fullTags, updateFormData));

    act(() => {
      result.current.setNewTag("tag6");
    });
    act(() => {
      result.current.addTag();
    });

    expect(updateFormData).not.toHaveBeenCalled();
    expect(result.current.tagError).toBe("Maximum 5 tags allowed.");
  });

  it("removes a tag by index", () => {
    const formData = {
      tags: [
        { label: "a", dismissLabel: "Remove a tag" },
        { label: "b", dismissLabel: "Remove b tag" },
        { label: "c", dismissLabel: "Remove c tag" },
      ],
    } as unknown as FormData;
    const updateFormData = vi.fn();
    const { result } = renderHook(() => useTagManagement(formData, updateFormData));

    act(() => {
      result.current.removeTag(1);
    });

    expect(updateFormData).toHaveBeenCalledWith({
      tags: [
        { label: "a", dismissLabel: "Remove a tag" },
        { label: "c", dismissLabel: "Remove c tag" },
      ],
    });
  });
});
