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
    regions: [],
    rampUpUnit: "minutes",
    rampUpValue: "1",
    holdForUnit: "minutes",
    holdForValue: "5",
  };

  test("scriptFile is reset to empty when acknowledged is false and file upload is attempted", () => {
    render(<FileUploadSection formData={defaultFormData} updateFormData={mockUpdateFormData} />);

    const fileInput = screen.getByLabelText(/Choose file/i);
    const mockFile = new File(["test content"], "test.js", { type: "application/javascript" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({ scriptFile: [] });
  });

  test("scriptFile is not empty when acknowledged is true and file upload is attempted", () => {
    const k6FormData = { ...defaultFormData, testType: TestTypes.K6 };

    render(<FileUploadSection formData={k6FormData} updateFormData={mockUpdateFormData} />);

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const fileInput = screen.getByLabelText(/Choose file/i);
    const mockFile = new File(["test content"], "test.js", { type: "application/javascript" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [mockFile],
      fileError: "",
    });
  });

  test("k6 accepts TypeScript (.ts) files when acknowledged", () => {
    const k6FormData = { ...defaultFormData, testType: TestTypes.K6 };

    render(<FileUploadSection formData={k6FormData} updateFormData={mockUpdateFormData} />);

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const fileInput = screen.getByLabelText(/Choose file/i);
    const mockFile = new File(["test content"], "test.ts", { type: "application/typescript" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [mockFile],
      fileError: "",
    });
  });

  test("k6 accepts both .js and .ts files", () => {
    const k6FormData = { ...defaultFormData, testType: TestTypes.K6 };

    render(<FileUploadSection formData={k6FormData} updateFormData={mockUpdateFormData} />);

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const fileInput = screen.getByLabelText(/Choose file/i);

    // Test .js file
    const jsFile = new File(["js content"], "test.js", { type: "application/javascript" });
    fireEvent.change(fileInput, { target: { files: [jsFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [jsFile],
      fileError: "",
    });

    mockUpdateFormData.mockClear();

    // Test .ts file
    const tsFile = new File(["ts content"], "test.ts", { type: "application/typescript" });
    fireEvent.change(fileInput, { target: { files: [tsFile] } });

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      scriptFile: [tsFile],
      fileError: "",
    });
  });
});
