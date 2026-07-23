// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestTypeSection } from "../../pages/scenarios/components/TestTypeSection";
import { TestTypes } from "../../pages/scenarios/constants";
import { FormData } from "../../pages/scenarios/types";

const formDataFor = (testType: TestTypes) => ({ testType }) as unknown as FormData;

describe("TestTypeSection", () => {
  it("renders all test type options and the framework disclaimer", () => {
    render(<TestTypeSection formData={formDataFor(TestTypes.SIMPLE)} updateFormData={vi.fn()} />);
    expect(screen.getByText("Test Type")).toBeInTheDocument();
    expect(screen.getByText("Third-Party Testing Frameworks")).toBeInTheDocument();
    expect(screen.getByText("Single HTTP Endpoint")).toBeInTheDocument();
    expect(screen.getByText("JMeter")).toBeInTheDocument();
    expect(screen.getByText("K6")).toBeInTheDocument();
    expect(screen.getByText("Locust")).toBeInTheDocument();
  });

  it("shows the K6 security alert when K6 is selected", () => {
    render(<TestTypeSection formData={formDataFor(TestTypes.K6)} updateFormData={vi.fn()} />);
    expect(screen.getByText(/K6 security policy/)).toBeInTheDocument();
  });

  it("shows the JMeter security alert and plugins section when JMeter is selected", () => {
    render(<TestTypeSection formData={formDataFor(TestTypes.JMETER)} updateFormData={vi.fn()} />);
    expect(screen.getByText(/Pre-installed Plugins/)).toBeInTheDocument();
    expect(screen.getByText(/Need additional plugins/)).toBeInTheDocument();
  });

  it("shows the Simple test type JMeter alert when Simple is selected", () => {
    render(<TestTypeSection formData={formDataFor(TestTypes.SIMPLE)} updateFormData={vi.fn()} />);
    expect(screen.getByText(/This test uses Apache JMeter/)).toBeInTheDocument();
  });

  it("shows the Locust security alert when Locust is selected", () => {
    render(<TestTypeSection formData={formDataFor(TestTypes.LOCUST)} updateFormData={vi.fn()} />);
    expect(screen.getByText(/Locust security page/)).toBeInTheDocument();
  });

  it("calls updateFormData and onTestTypeChange when the type changes", () => {
    const updateFormData = vi.fn();
    const onTestTypeChange = vi.fn();
    render(
      <TestTypeSection
        formData={formDataFor(TestTypes.SIMPLE)}
        updateFormData={updateFormData}
        onTestTypeChange={onTestTypeChange}
      />
    );
    screen.getByText("JMeter").click();
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({ testType: TestTypes.JMETER, scriptFile: [], k6LicenseAcknowledged: false })
    );
    expect(onTestTypeChange).toHaveBeenCalled();
  });

  it("does not call onTestTypeChange when it is not provided", () => {
    const updateFormData = vi.fn();
    render(<TestTypeSection formData={formDataFor(TestTypes.SIMPLE)} updateFormData={updateFormData} />);
    screen.getByText("K6").click();
    expect(updateFormData).toHaveBeenCalledWith(expect.objectContaining({ testType: TestTypes.K6 }));
  });
});
