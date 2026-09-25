// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TestDurationSection } from "../../pages/scenarios/components/TestDurationSection";
import { holdForError, rampUpError } from "../../pages/scenarios/utils/scenarioValidation";
import { FormData } from "../../pages/scenarios/types";

const baseFormData = {
  rampUpValue: "",
  rampUpUnit: "minutes",
  holdForValue: "",
  holdForUnit: "minutes",
} as unknown as FormData;

// The friendly message is unit-dependent, matching the shared
// ramp-up/hold-for schema bounds.
describe("rampUpError", () => {
  it("is silent until the field is touched or a submit is attempted", () => {
    expect(rampUpError("", "minutes", false)).toBeUndefined();
    expect(rampUpError("", "minutes", true)).toBe("Ramp up is required");
  });

  it("stays silent until shown, then rejects a non-integer", () => {
    expect(rampUpError("3.5", "minutes", false)).toBeUndefined();
    expect(rampUpError("3.5", "minutes", true)).toBe("Ramp up must be an integer between 0 and 1440 minutes");
  });

  it("uses the minutes bound message and rejects above 1440 minutes", () => {
    expect(rampUpError("0", "minutes", true)).toBeUndefined();
    expect(rampUpError("1440", "minutes", true)).toBeUndefined();
    expect(rampUpError("1441", "minutes", true)).toBe("Ramp up must be an integer between 0 and 1440 minutes");
  });

  it("uses the seconds bound message and rejects above 3600 seconds", () => {
    expect(rampUpError("3600", "seconds", true)).toBeUndefined();
    expect(rampUpError("3601", "seconds", true)).toBe("Ramp up must be an integer between 0 and 3600 seconds");
  });

  it("uses the hours bound message and rejects above 168 hours", () => {
    expect(rampUpError("168", "hours", true)).toBeUndefined();
    expect(rampUpError("169", "hours", true)).toBe("Ramp up must be an integer between 0 and 168 hours");
  });

  it("accepts a valid value", () => {
    expect(rampUpError("5", "minutes", true)).toBeUndefined();
  });
});

describe("holdForError", () => {
  it("is silent until the field is touched or a submit is attempted", () => {
    expect(holdForError("", "minutes", false)).toBeUndefined();
    expect(holdForError("", "minutes", true)).toBe("Hold for is required");
  });

  it("stays silent until shown, then rejects a non-integer", () => {
    expect(holdForError("3.5", "minutes", false)).toBeUndefined();
    expect(holdForError("3.5", "minutes", true)).toBe("Hold for must be an integer between 1 and 1440 minutes");
  });

  it("uses the minutes bound message and rejects outside 1 to 1440 minutes", () => {
    expect(holdForError("1440", "minutes", true)).toBeUndefined();
    expect(holdForError("1441", "minutes", true)).toBe("Hold for must be an integer between 1 and 1440 minutes");
    expect(holdForError("0", "minutes", true)).toBe("Hold for must be an integer between 1 and 1440 minutes");
  });

  // Unit-dependent branch: seconds get their own bound message.
  it("uses the seconds bound message and rejects above 3600 seconds", () => {
    expect(holdForError("3600", "seconds", true)).toBeUndefined();
    expect(holdForError("3601", "seconds", true)).toBe("Hold for must be an integer between 1 and 3600 seconds");
  });

  it("uses the hours bound message and rejects above 168 hours", () => {
    expect(holdForError("168", "hours", true)).toBeUndefined();
    expect(holdForError("169", "hours", true)).toBe("Hold for must be an integer between 1 and 168 hours");
  });

  it("accepts a valid value", () => {
    expect(holdForError("10", "minutes", true)).toBeUndefined();
  });
});

describe("TestDurationSection", () => {
  it("renders ramp up and hold for", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.getByText("Test Duration")).toBeInTheDocument();
    expect(screen.getByText("Ramp Up")).toBeInTheDocument();
    expect(screen.getByText("Hold For")).toBeInTheDocument();
  });

  it("shows the hold-for required error on blur", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.queryByText("Hold for is required")).not.toBeInTheDocument();

    // Two numeric inputs render: [0] ramp up, [1] hold for.
    fireEvent.blur(screen.getAllByRole("spinbutton")[1]);
    expect(screen.getByText("Hold for is required")).toBeInTheDocument();
  });

  it("shows both required errors when a submit was attempted", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} showValidationErrors />);
    expect(screen.getByText("Ramp up is required")).toBeInTheDocument();
    expect(screen.getByText("Hold for is required")).toBeInTheDocument();
  });

  it("shows ramp-up required error on blur", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    fireEvent.blur(screen.getAllByRole("spinbutton")[0]);
    expect(screen.getByText("Ramp up is required")).toBeInTheDocument();
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

  it("renders all unit segments for each phase", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Seconds" })).toHaveLength(2);
    const minuteButtons = screen.getAllByRole("button", { name: "Minutes" });
    expect(minuteButtons).toHaveLength(2);
    minuteButtons.forEach((button) => expect(button).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getAllByRole("button", { name: "Hours" })).toHaveLength(2);
  });

  it("switches a phase unit when a segment is clicked", () => {
    const updateFormData = vi.fn();
    render(<TestDurationSection formData={baseFormData} updateFormData={updateFormData} />);
    fireEvent.click(screen.getAllByText("Hours")[0]);
    expect(updateFormData).toHaveBeenCalledWith({ rampUpUnit: "hours" });
  });

  it("shows a placeholder total when no durations are entered", () => {
    render(<TestDurationSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.getByText("Total estimated duration:")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ignores invalid values in the estimated total", () => {
    const invalidData: FormData = { ...baseFormData, rampUpValue: "abc" };
    render(<TestDurationSection formData={invalidData} updateFormData={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("computes the humanized total across mixed units", () => {
    const filledData: FormData = {
      ...baseFormData,
      rampUpValue: "1",
      rampUpUnit: "minutes",
      holdForValue: "30",
      holdForUnit: "seconds",
    };
    render(<TestDurationSection formData={filledData} updateFormData={vi.fn()} />);
    // 1m + 30s = 90s -> "1m 30s"
    expect(screen.getByText("1m 30s")).toBeInTheDocument();
  });

  it("computes the total when hours are selected", () => {
    const filledData: FormData = {
      ...baseFormData,
      rampUpValue: "1",
      rampUpUnit: "hours",
      holdForValue: "30",
      holdForUnit: "minutes",
    };
    render(<TestDurationSection formData={filledData} updateFormData={vi.fn()} />);
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });

  it("renders pre-filled values", () => {
    const filledData: FormData = {
      ...baseFormData,
      rampUpValue: "30",
      holdForValue: "60",
      rampUpUnit: "seconds",
      holdForUnit: "seconds",
    };
    render(<TestDurationSection formData={filledData} updateFormData={vi.fn()} />);
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(30);
    expect(screen.getAllByRole("spinbutton")[1]).toHaveValue(60);
  });
});
