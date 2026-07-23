// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TestDurationSection } from "../../pages/scenarios/components/TestDurationSection";
import { FormData } from "../../pages/scenarios/types";

const baseFormData = {
  rampUpValue: "",
  rampUpUnit: "minutes",
  holdForValue: "",
  holdForUnit: "minutes",
} as unknown as FormData;

describe("TestDurationSection", () => {
  it("renders ramp up and hold for", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.getByText("Test Duration")).toBeInTheDocument();
    expect(screen.getByText("Ramp Up")).toBeInTheDocument();
    expect(screen.getByText("Hold For")).toBeInTheDocument();
  });

  it("shows the hold-for required error on blur", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.queryByText("Hold for time is required")).not.toBeInTheDocument();

    // Two numeric inputs render: [0] ramp up, [1] hold for.
    fireEvent.blur(screen.getAllByRole("spinbutton")[1]);
    expect(screen.getByText("Hold for time is required")).toBeInTheDocument();
  });

  it("shows both required errors when a submit was attempted", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} showValidationErrors />);
    expect(screen.getByText("Ramp up time is required")).toBeInTheDocument();
    expect(screen.getByText("Hold for time is required")).toBeInTheDocument();
  });

  it("shows ramp-up required error on blur", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    fireEvent.blur(screen.getAllByRole("spinbutton")[0]);
    expect(screen.getByText("Ramp up time is required")).toBeInTheDocument();
  });

  it("calls updateFormData when ramp-up value changes", () => {
    const updateFormData = vi.fn();
    render(<TestDurationSection formData={baseFormData} updateFormData={updateFormData} />);
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "5" } });
    expect(updateFormData).toHaveBeenCalledWith({ rampUpValue: "5" });
  });

  it("calls updateFormData when hold-for value changes", () => {
    const updateFormData = vi.fn();
    render(<TestDurationSection formData={baseFormData} updateFormData={updateFormData} />);
    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "10" } });
    expect(updateFormData).toHaveBeenCalledWith({ holdForValue: "10" });
  });

  it("renders unit select options", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    // Default is "minutes" for both selects
    expect(screen.getAllByText("minutes")).toHaveLength(2);
  });

  it("renders pre-filled values", () => {
    const filledData = {
      ...baseFormData,
      rampUpValue: "30",
      holdForValue: "60",
      rampUpUnit: "seconds",
      holdForUnit: "seconds",
    } as unknown as FormData;
    render(<TestDurationSection formData={filledData} updateFormData={vi.fn()} />);
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(30);
    expect(screen.getAllByRole("spinbutton")[1]).toHaveValue(60);
  });
});
