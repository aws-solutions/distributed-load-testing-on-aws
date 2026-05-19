// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FileUploadSection } from "../../pages/scenarios/components/FileUploadSection";
import { TestTypes } from "../../pages/scenarios/constants";
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
    rampUpUnit: "minutes",
    rampUpValue: "1",
    holdForUnit: "minutes",
    holdForValue: "5",
    healthyThreshold: "90",
    k6LicenseAcknowledged: false,
  };

  test("file upload works without license acknowledgment for K6", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} />);

    const fileInput = screen.getByLabelText(/Choose file/i);
    const mockFile = new File(["test content"], "test.js", { type: "application/javascript" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [mockFile],
      fileError: "",
    });
  });

  test("license checkbox updates k6LicenseAcknowledged in form data", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} />);

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(mockUpdateFormData).toHaveBeenCalledWith({ k6LicenseAcknowledged: true });
  });

  test("k6 accepts TypeScript (.ts) files", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} />);

    const fileInput = screen.getByLabelText(/Choose file/i);
    const mockFile = new File(["test content"], "test.ts", { type: "application/typescript" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [mockFile],
      fileError: "",
    });
  });

  test("k6 accepts both .js and .ts files", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} />);

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
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
  });

  test("license checkbox is not shown for non-K6 test types", () => {
    const jmeterFormData = { ...defaultFormData, testType: TestTypes.JMETER };
    render(<FileUploadSection formData={jmeterFormData} updateFormData={mockUpdateFormData} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
