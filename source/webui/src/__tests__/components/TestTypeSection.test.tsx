// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestTypeSection } from "../../pages/scenarios/components/TestTypeSection";
import { TestMode, TestTypes } from "../../pages/scenarios/constants";
import { FormData } from "../../pages/scenarios/types";

const formDataFor = (testType: TestTypes, testMode: TestMode = TestMode.STANDARD) =>
  ({ testType, testMode }) as unknown as FormData;

const SECURITY_DETAILS_KEY = "security-framework-details-expanded";

const storedExpandedMap = () => JSON.parse(localStorage.getItem(SECURITY_DETAILS_KEY) ?? "{}");

// The expandable header carries aria-expanded; walk up from its text to it.
const securityDetailsToggle = () => screen.getByText("Security and framework details").closest("[aria-expanded]");

const renderSection = (testType: TestTypes, testMode: TestMode = TestMode.STANDARD, overrides = {}) => {
  const updateFormData = vi.fn();
  const onModeChange = vi.fn();
  const { container } = render(
    <TestTypeSection
      formData={formDataFor(testType, testMode)}
      updateFormData={updateFormData}
      onModeChange={onModeChange}
      {...overrides}
    />
  );
  const wrapper = createWrapper(container);
  const [typeControl, trafficControl] = wrapper.findAllSegmentedControls();
  return { updateFormData, onModeChange, typeControl, trafficControl };
};

describe("TestTypeSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders all test type options and the framework disclaimer", () => {
    const { typeControl } = renderSection(TestTypes.SIMPLE);
    expect(screen.getByText("Test Type")).toBeInTheDocument();
    expect(screen.getByText("Third-Party Testing Frameworks")).toBeInTheDocument();
    // Confirm all 4 test type segments exist by ID (SegmentedControl may render text twice).
    expect(typeControl.findSegmentById(TestTypes.SIMPLE)).not.toBeNull();
    expect(typeControl.findSegmentById(TestTypes.JMETER)).not.toBeNull();
    expect(typeControl.findSegmentById(TestTypes.K6)).not.toBeNull();
    expect(typeControl.findSegmentById(TestTypes.LOCUST)).not.toBeNull();
  });

  it("renders the Traffic shape control with Standard and Native options", () => {
    const { trafficControl } = renderSection(TestTypes.JMETER);
    expect(screen.getByText("Traffic shape")).toBeInTheDocument();
    expect(trafficControl.findSegmentById(TestMode.STANDARD)).not.toBeNull();
    expect(trafficControl.findSegmentById(TestMode.NATIVE)).not.toBeNull();
  });

  it.each([
    {
      testType: TestTypes.JMETER,
      nativeDescription: "DLT runs the JMeter test script as written.",
    },
    {
      testType: TestTypes.K6,
      nativeDescription: "DLT runs the k6 test script as written.",
    },
    {
      testType: TestTypes.LOCUST,
      nativeDescription: "DLT runs the Locust test script as written.",
    },
    {
      testType: TestTypes.SIMPLE,
      nativeDescription: "Not available for Simple HTTP Endpoint",
    },
  ])("shows persistent Standard and Native descriptions for $testType", ({ testType, nativeDescription }) => {
    renderSection(testType);

    expect(screen.queryByText("Standard mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Native mode")).not.toBeInTheDocument();
    expect(screen.getByText("DLT overrides all framework traffic and durations.")).toBeInTheDocument();
    expect(screen.getByText(nativeDescription)).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it.each([TestMode.STANDARD, TestMode.NATIVE])("shows both descriptions when %s is selected", (testMode) => {
    renderSection(TestTypes.JMETER, testMode);

    expect(screen.getByText("DLT overrides all framework traffic and durations.")).toBeInTheDocument();
    expect(screen.getByText("DLT runs the JMeter test script as written.")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.queryByText("Explain the difference")).not.toBeInTheDocument();
    expect(createWrapper(document.body).findTable()).toBeNull();
  });

  it("disables Native when HTTP Endpoint is selected", () => {
    const { trafficControl } = renderSection(TestTypes.SIMPLE);
    expect(trafficControl.findSegmentById(TestMode.NATIVE)?.getElement()).toBeDisabled();
  });

  it("enables Native when a script framework is selected", () => {
    for (const testType of [TestTypes.JMETER, TestTypes.K6, TestTypes.LOCUST]) {
      const { trafficControl } = renderSection(testType);
      expect(trafficControl.findSegmentById(TestMode.NATIVE)?.getElement()).not.toBeDisabled();
    }
  });

  it("calls onModeChange when Native is clicked", () => {
    const { trafficControl, onModeChange } = renderSection(TestTypes.JMETER);
    trafficControl.findSegmentById(TestMode.NATIVE)!.click();
    expect(onModeChange).toHaveBeenCalledWith(TestMode.NATIVE);
  });

  it("calls onModeChange(Standard) and updateFormData when switching to HTTP Endpoint while in native mode", () => {
    const { typeControl, onModeChange, updateFormData } = renderSection(TestTypes.JMETER, TestMode.NATIVE);
    typeControl.findSegmentById(TestTypes.SIMPLE)!.click();
    expect(onModeChange).toHaveBeenCalledWith(TestMode.STANDARD);
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({ testType: TestTypes.SIMPLE, scriptFile: [], k6LicenseAcknowledged: false })
    );
  });

  it("does not call onModeChange when switching type while already in Standard mode", () => {
    const { typeControl, onModeChange } = renderSection(TestTypes.JMETER, TestMode.STANDARD);
    typeControl.findSegmentById(TestTypes.SIMPLE)!.click();
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("resets script fields via updateFormData when the type changes", () => {
    const { typeControl, updateFormData } = renderSection(TestTypes.SIMPLE, TestMode.STANDARD);
    typeControl.findSegmentById(TestTypes.JMETER)!.click();
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({ testType: TestTypes.JMETER, scriptFile: [], k6LicenseAcknowledged: false })
    );
  });

  it("shows framework details expanded by default when no preference is stored", () => {
    renderSection(TestTypes.SIMPLE);
    expect(securityDetailsToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("respects a stored collapsed preference for the selected framework", () => {
    localStorage.setItem(SECURITY_DETAILS_KEY, JSON.stringify({ [TestTypes.SIMPLE]: false }));
    render(<TestTypeSection formData={formDataFor(TestTypes.SIMPLE)} updateFormData={vi.fn()} onModeChange={vi.fn()} />);
    expect(securityDetailsToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the section expanded for a framework with no stored preference", () => {
    // Only SIMPLE is collapsed; K6 has no entry, so it stays expanded.
    localStorage.setItem(SECURITY_DETAILS_KEY, JSON.stringify({ [TestTypes.SIMPLE]: false }));
    render(<TestTypeSection formData={formDataFor(TestTypes.K6)} updateFormData={vi.fn()} onModeChange={vi.fn()} />);
    expect(securityDetailsToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("persists the open/closed choice per framework when toggled", () => {
    render(<TestTypeSection formData={formDataFor(TestTypes.SIMPLE)} updateFormData={vi.fn()} onModeChange={vi.fn()} />);
    const toggle = securityDetailsToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle!);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(storedExpandedMap()).toEqual({ [TestTypes.SIMPLE]: false });

    fireEvent.click(toggle!);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(storedExpandedMap()).toEqual({ [TestTypes.SIMPLE]: true });
  });

  it("does not apply one framework's collapsed state to another framework", () => {
    // Collapse for SIMPLE, then re-render as K6 — the banner should reappear.
    const { rerender } = render(
      <TestTypeSection formData={formDataFor(TestTypes.SIMPLE)} updateFormData={vi.fn()} onModeChange={vi.fn()} />
    );
    fireEvent.click(securityDetailsToggle()!);
    expect(securityDetailsToggle()).toHaveAttribute("aria-expanded", "false");

    rerender(<TestTypeSection formData={formDataFor(TestTypes.K6)} updateFormData={vi.fn()} onModeChange={vi.fn()} />);
    expect(securityDetailsToggle()).toHaveAttribute("aria-expanded", "true");
    // SIMPLE's collapsed preference is untouched.
    expect(storedExpandedMap()).toEqual({ [TestTypes.SIMPLE]: false });
  });

  it("shows the K6 security alert when K6 is selected", () => {
    renderSection(TestTypes.K6);
    expect(screen.getByText(/K6 security policy/)).toBeInTheDocument();
  });

  it("shows the JMeter security alert when JMeter is selected", () => {
    renderSection(TestTypes.JMETER);
    expect(screen.getByText(/known security vulnerabilities/)).toBeInTheDocument();
  });

  it("shows the Simple test type JMeter alert when Simple is selected", () => {
    renderSection(TestTypes.SIMPLE);
    expect(screen.getByText(/This test uses Apache JMeter/)).toBeInTheDocument();
  });

  it("shows the Locust security alert when Locust is selected", () => {
    renderSection(TestTypes.LOCUST);
    expect(screen.getByText(/Locust security page/)).toBeInTheDocument();
  });
});
