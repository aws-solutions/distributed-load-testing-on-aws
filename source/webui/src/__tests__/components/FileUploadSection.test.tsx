// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FileUploadSection } from "../../pages/scenarios/components/FileUploadSection";
import { TestMode, TestTypes } from "../../pages/scenarios/constants";
import { createEmptyNativeModeInput } from "../../pages/scenarios/hooks/useFormData";
import { FormData } from "../../pages/scenarios/types";

describe("FileUploadSection", () => {
  const mockUpdateFormData = vi.fn();

  beforeEach(() => {
    mockUpdateFormData.mockClear();
  });

  const defaultFormData: FormData = {
    testName: "",
    testDescription: "",
    testId: "",
    testType: TestTypes.K6,
    executionTiming: "",
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
    scheduleTimezone: "UTC",
    regions: [],
    testMode: TestMode.STANDARD,
    rampUpUnit: "minutes",
    rampUpValue: "1",
    holdForUnit: "minutes",
    holdForValue: "5",
    nativeMode: createEmptyNativeModeInput(),
    healthyThreshold: "90",
    k6LicenseAcknowledged: false,
  };

  test("file upload works without license acknowledgment for K6", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()} />);

    const fileInput = screen.getByLabelText(/Choose file/i);
    const mockFile = new File(["test content"], "test.js", { type: "application/javascript" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [mockFile],
      fileError: "",
    });
  });

  test("license checkbox updates k6LicenseAcknowledged in form data", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(mockUpdateFormData).toHaveBeenCalledWith({ k6LicenseAcknowledged: true });
  });

  test("k6 accepts TypeScript (.ts) files", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()} />);

    const fileInput = screen.getByLabelText(/Choose file/i);
    const mockFile = new File(["test content"], "test.ts", { type: "application/typescript" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [mockFile],
      fileError: "",
    });
  });

  test("k6 accepts both .js and .ts files", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()} />);

    const fileInput = screen.getByLabelText(/Choose file/i);

    const jsFile = new File(["js content"], "test.js", { type: "application/javascript" });
    fireEvent.change(fileInput, { target: { files: [jsFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [jsFile],
      fileError: "",
    });

    mockUpdateFormData.mockClear();

    const tsFile = new File(["ts content"], "test.ts", { type: "application/typescript" });
    fireEvent.change(fileInput, { target: { files: [tsFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [tsFile],
      fileError: "",
    });
  });

  test("K6 license checkbox is not auto-checked when scriptFile is empty", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
  });

  test("license checkbox is not shown for non-K6 test types", () => {
    const jmeterFormData = { ...defaultFormData, testType: TestTypes.JMETER };
    render(<FileUploadSection formData={jmeterFormData} updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  describe("JMeter plugins banner", () => {
    test("shows the pre-installed plugins and custom-plugin guidance for JMeter", () => {
      render(
        <FileUploadSection
          formData={{ ...defaultFormData, testType: TestTypes.JMETER }}
          updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()}
        />
      );
      expect(screen.getByText(/Pre-installed Plugins/)).toBeInTheDocument();
      expect(screen.getByText(/Uploading supporting files or plugins/)).toBeInTheDocument();
      expect(screen.getByText(/Reference CSV data files using paths relative/)).toBeInTheDocument();
      expect(screen.getByText(/Absolute paths will not resolve/)).toBeInTheDocument();
    });

    test("stays hidden for non-JMeter test types", () => {
      render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()} />);
      expect(screen.queryByText(/Pre-installed Plugins/)).not.toBeInTheDocument();
    });
  });

  describe("Locust processes warning", () => {
    const processesInfoBox = () => screen.queryByText(/single process/);

    test("warns about the processes setting for native-mode Locust", () => {
      render(
        <FileUploadSection
          formData={{ ...defaultFormData, testType: TestTypes.LOCUST, testMode: TestMode.NATIVE }}
          updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()}
        />
      );
      expect(screen.getByText("Some Locust settings aren't supported")).toBeInTheDocument();
      expect(processesInfoBox()).toBeInTheDocument();
      expect(screen.getByText(/increase task count to scale across more containers/)).toBeInTheDocument();
    });

    test("stays hidden for Standard-mode Locust", () => {
      render(
        <FileUploadSection
          formData={{ ...defaultFormData, testType: TestTypes.LOCUST, testMode: TestMode.STANDARD }}
          updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()}
        />
      );
      expect(processesInfoBox()).not.toBeInTheDocument();
    });

    test("stays hidden for other test types", () => {
      render(
        <FileUploadSection
          formData={{ ...defaultFormData, testType: TestTypes.JMETER, testMode: TestMode.NATIVE }}
          updateFormData={mockUpdateFormData} updateNativeMode={vi.fn()}
        />
      );
      expect(processesInfoBox()).not.toBeInTheDocument();
    });
  });
});
