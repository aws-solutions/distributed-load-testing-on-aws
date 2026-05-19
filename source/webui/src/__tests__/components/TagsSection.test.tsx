// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TagsSection } from "../../pages/scenarios/components/TagsSection";

const baseProps = {
  formData: { tags: [{ label: "tag1", dismissLabel: "Remove tag1" }] } as any,
  newTag: "",
  setNewTag: vi.fn(),
  tagError: "",
  setTagError: vi.fn(),
  addTag: vi.fn(),
  removeTag: vi.fn(),
};

describe("TagsSection", () => {
  it("renders header and existing tags", () => {
    render(<TagsSection {...baseProps} />);
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("tag1")).toBeInTheDocument();
    expect(screen.getByText(/You can add 4 more tags/)).toBeInTheDocument();
  });
});
