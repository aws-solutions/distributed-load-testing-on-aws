// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { formatToLocalTime } from "../dateUtils";

describe("formatToLocalTime", () => {
  it("should return '-' for undefined input", () => {
    expect(formatToLocalTime(undefined)).toBe("-");
  });

  it("should return '-' for empty string", () => {
    expect(formatToLocalTime("")).toBe("-");
  });

  it("should return '-' for invalid date string", () => {
    expect(formatToLocalTime("invalid-date")).toBe("-");
  });

  it("should format valid UTC date string", () => {
    const result = formatToLocalTime("2023-12-25 10:30:00");
    expect(result).not.toBe("-");
    expect(typeof result).toBe("string");
  });

  it("should format valid ISO date string", () => {
    const result = formatToLocalTime("2023-12-25T10:30:00");
    expect(result).not.toBe("-");
    expect(typeof result).toBe("string");
  });

  it("should apply custom formatting options", () => {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric"
    };
    const result = formatToLocalTime("2023-12-25 10:30:00", options);
    expect(result).toMatch(/Dec.*25.*2023/);
  });
});