// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { TestTypes } from "../../pages/scenarios/constants";

const getFileExtension = (testType: string) => {
  switch (testType) {
    case TestTypes.JMETER:
      return ".jmx";
    case TestTypes.K6:
      return ".js";
    case TestTypes.LOCUST:
      return ".py";
    default:
      return "";
  }
};

const validateFileSize = (files: File[]) => {
  const maxSize = 100 * 1024 * 1024; // 100MB
  const validFiles = files.filter((file) => file.size <= maxSize);
  return {
    validFiles,
    hasError: validFiles.length !== files.length,
    errorMessage: "File size must be 100MB or less",
  };
};

describe("getFileExtension", () => {
  test("returns correct extensions", () => {
    expect(getFileExtension("jmeter")).toBe(".jmx");
    expect(getFileExtension("k6")).toBe(".js");
    expect(getFileExtension("locust")).toBe(".py");
    expect(getFileExtension("unknown")).toBe("");
  });
});

describe("validateFileSize", () => {
  test("validates file size correctly", () => {
    const validFile = new File(["content"], "test.jmx", { type: "text/xml" });
    const largeFile = Object.defineProperty(new File(["content"], "large.jmx"), "size", { value: 200 * 1024 * 1024 });

    const validResult = validateFileSize([validFile]);
    expect(validResult.hasError).toBe(false);

    const invalidResult = validateFileSize([largeFile]);
    expect(invalidResult.hasError).toBe(true);
    expect(invalidResult.errorMessage).toBe("File size must be 100MB or less");
  });
});
