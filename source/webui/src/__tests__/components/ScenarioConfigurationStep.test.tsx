// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { ScenarioConfigurationStep } from "../../pages/scenarios/components/ScenarioConfigurationStep";
import { FormData } from "../../pages/scenarios/types";
import { TestTypes } from "../../pages/scenarios/constants";

function createFormData(overrides: Partial<FormData> = {}): FormData {
  return {
    testId: "test-123",
    testName: "Test",
    testDescription: "",
    testType: TestTypes.SIMPLE,
    executionTiming: "run-now",
    showLive: false,
    scriptFile: [],
    fileError: "",
    tags: [],
    httpEndpoint: "",
    httpMethod: { label: "GET", value: "GET" },
    requestHeaders: "",
    bodyPayload: "",
    scheduleTime: "",
    scheduleDate: "",
    cronMinutes: "",
    cronHours: "",
    cronDayOfMonth: "",
    cronMonth: "",
    cronDayOfWeek: "",
    cronExpiryDate: "",
    scheduleTimezone: "",
    regions: [],
    rampUpUnit: "minutes",
    rampUpValue: "",
    holdForUnit: "minutes",
    holdForValue: "",
    healthyThreshold: "90",
    k6LicenseAcknowledged: false,
    ...overrides,
  };
}

function renderComponent(formData: FormData, updateFormData = vi.fn(), showValidationErrors = false) {
  const result = render(
    <ScenarioConfigurationStep
      formData={formData}
      updateFormData={updateFormData}
      onTestTypeChange={vi.fn()}
      showValidationErrors={showValidationErrors}
    />,
  );
  return { wrapper: createWrapper(result.container), updateFormData };
}

describe("ScenarioConfigurationStep", () => {
  test("renders test type radio group with all options", () => {
    renderComponent(createFormData());

    expect(screen.getByText("Single HTTP Endpoint")).toBeInTheDocument();
    expect(screen.getByText("JMeter")).toBeInTheDocument();
    expect(screen.getByText("K6")).toBeInTheDocument();
    expect(screen.getByText("Locust")).toBeInTheDocument();
  });

  test("renders HTTP endpoint fields for simple test type", () => {
    renderComponent(createFormData({ testType: TestTypes.SIMPLE }));

    expect(screen.getByText("HTTP Endpoint Configuration")).toBeInTheDocument();
    expect(screen.getByText("HTTP Endpoint")).toBeInTheDocument();
    expect(screen.getByText("HTTP Method")).toBeInTheDocument();
  });

  test("renders file upload for JMeter test type", () => {
    renderComponent(createFormData({ testType: TestTypes.JMETER }));

    expect(screen.getByText("Third-Party Testing Frameworks")).toBeInTheDocument();
    expect(screen.queryByText("HTTP Endpoint Configuration")).not.toBeInTheDocument();
  });

  test("renders file upload for K6 test type", () => {
    renderComponent(createFormData({ testType: TestTypes.K6 }));

    expect(screen.queryByText("HTTP Endpoint Configuration")).not.toBeInTheDocument();
  });

  test("shows validation error when HTTP endpoint is empty", () => {
    renderComponent(createFormData({ httpEndpoint: "" }), vi.fn(), true);

    expect(screen.getByText("HTTP endpoint is required")).toBeInTheDocument();
  });

  test("calls updateFormData when HTTP endpoint changes", () => {
    const { wrapper, updateFormData } = renderComponent(createFormData());

    const input = wrapper.findInput('[data-cy="http-endpoint-input"]')!;
    input.setInputValue("https://example.com");

    expect(updateFormData).toHaveBeenCalledWith({ httpEndpoint: "https://example.com" });
  });

  test("shows invalid JSON warning for request headers", () => {
    renderComponent(createFormData({ requestHeaders: "{invalid" }));

    expect(screen.getByText("WARNING: headers text is not valid JSON")).toBeInTheDocument();
  });

  test("shows invalid JSON warning for body payload", () => {
    renderComponent(createFormData({ bodyPayload: "{invalid" }));

    expect(screen.getByText("WARNING: body payload text is not valid JSON")).toBeInTheDocument();
  });

  test("clears scriptFile and fileError when switching test type", () => {
    const { wrapper, updateFormData } = renderComponent(
      createFormData({ testType: TestTypes.JMETER }),
    );

    const radioGroup = wrapper.findRadioGroup()!;
    radioGroup.findInputByValue(TestTypes.K6)!.click();

    expect(updateFormData).toHaveBeenCalledWith({
      testType: TestTypes.K6,
      scriptFile: [],
      fileError: "",
      k6LicenseAcknowledged: false,
    });
  });
});
