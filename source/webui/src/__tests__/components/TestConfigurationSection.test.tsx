// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestConfigurationSection } from "../../pages/scenarios/components/TestConfigurationSection";

const baseProps = {
  formData: {
    testName: "My Test",
    testDescription: "A description",
    tags: [{ label: "tag1", dismissLabel: "Remove tag1" }],
  } as any,
  updateFormData: vi.fn(),
  newTag: "",
  setNewTag: vi.fn(),
  tagError: "",
  setTagError: vi.fn(),
  addTag: vi.fn(),
  removeTag: vi.fn(),
};

describe("TestConfigurationSection", () => {
  it("renders name and description fields with values", () => {
    render(<TestConfigurationSection {...baseProps} />);
    expect(screen.getByText("Test Configuration")).toBeInTheDocument();
    expect(screen.getByDisplayValue("My Test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A description")).toBeInTheDocument();
    expect(screen.getByText("Search keywords")).toBeInTheDocument();
    expect(screen.getByText("tag1")).toBeInTheDocument();
    expect(screen.getByText(/You can add 4 more keywords/)).toBeInTheDocument();
  });

  it("shows validation errors when enabled and fields are empty", () => {
    render(
      <TestConfigurationSection
        formData={{ testName: "", testDescription: "", tags: [] } as any}
        updateFormData={vi.fn()}
        showValidationErrors
        newTag=""
        setNewTag={vi.fn()}
        tagError=""
        setTagError={vi.fn()}
        addTag={vi.fn()}
        removeTag={vi.fn()}
      />
    );
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Description is required")).toBeInTheDocument();
    expect(screen.getByText(/You can add 5 more keywords/)).toBeInTheDocument();
  });

  it("does not flag leading/trailing whitespace as an error (auto-trimmed)", () => {
    render(
      <TestConfigurationSection
        {...baseProps}
        formData={{ ...baseProps.formData, testName: "  Valid Name  " } as any}
        showValidationErrors
      />
    );
    // Even with errors revealed, a padded-but-otherwise-valid name shows no name error.
    expect(screen.queryByText(/leading or trailing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Name must be|Name is required/)).not.toBeInTheDocument();
  });

  it("trims surrounding whitespace from the name on blur", () => {
    const updateFormData = vi.fn();
    render(
      <TestConfigurationSection
        {...baseProps}
        formData={{ ...baseProps.formData, testName: "  My Test  " } as any}
        updateFormData={updateFormData}
      />
    );
    // Query the input directly — getByDisplayValue normalizes whitespace and can't match padding.
    fireEvent.blur(document.querySelector('[data-cy="test-name-input"] input') as HTMLElement);
    expect(updateFormData).toHaveBeenCalledWith({ testName: "My Test" });
  });

  it("does not update the name on blur when it has no surrounding whitespace", () => {
    const updateFormData = vi.fn();
    render(<TestConfigurationSection {...baseProps} updateFormData={updateFormData} />);
    fireEvent.blur(document.querySelector('[data-cy="test-name-input"] input') as HTMLElement);
    expect(updateFormData).not.toHaveBeenCalled();
  });

  it("calls setNewTag and setTagError on input change within limit", () => {
    const setNewTag = vi.fn();
    const setTagError = vi.fn();
    render(<TestConfigurationSection {...baseProps} setNewTag={setNewTag} setTagError={setTagError} />);
    const input = screen.getByPlaceholderText("Enter keyword");
    fireEvent.change(input, { target: { value: "newtag" } });
    expect(setNewTag).toHaveBeenCalledWith("newtag");
    expect(setTagError).toHaveBeenCalledWith("");
  });

  it("does not call setNewTag when input exceeds 50 characters", () => {
    const setNewTag = vi.fn();
    render(<TestConfigurationSection {...baseProps} setNewTag={setNewTag} />);
    const input = screen.getByPlaceholderText("Enter keyword");
    fireEvent.change(input, { target: { value: "a".repeat(51) } });
    expect(setNewTag).not.toHaveBeenCalled();
  });

  it("calls addTag on Enter key when canAddTag is true", () => {
    const addTag = vi.fn();
    render(<TestConfigurationSection {...baseProps} newTag="mytag" addTag={addTag} />);
    const input = screen.getByPlaceholderText("Enter keyword");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(addTag).toHaveBeenCalled();
  });

  it("does not call addTag on Enter key when newTag is empty", () => {
    const addTag = vi.fn();
    render(<TestConfigurationSection {...baseProps} newTag="" addTag={addTag} />);
    const input = screen.getByPlaceholderText("Enter keyword");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(addTag).not.toHaveBeenCalled();
  });
});
