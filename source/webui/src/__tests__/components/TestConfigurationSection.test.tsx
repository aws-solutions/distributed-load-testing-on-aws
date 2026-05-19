// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestConfigurationSection } from "../../pages/scenarios/components/TestConfigurationSection";

const baseProps = {
  formData: { testName: "My Test", testDescription: "A description" } as any,
  updateFormData: vi.fn(),
};

describe("TestConfigurationSection", () => {
  it("renders name and description fields with values", () => {
    render(<TestConfigurationSection {...baseProps} />);
    expect(screen.getByText("Test Configuration")).toBeInTheDocument();
    expect(screen.getByDisplayValue("My Test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A description")).toBeInTheDocument();
  });

  it("shows validation errors when enabled and fields are empty", () => {
    render(
      <TestConfigurationSection
        formData={{ testName: "", testDescription: "" } as any}
        updateFormData={vi.fn()}
        showValidationErrors
      />
    );
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Description is required")).toBeInTheDocument();
  });
});
