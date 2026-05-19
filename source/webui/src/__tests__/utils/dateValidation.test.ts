// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { validateExpiryDate } from "../../utils/dateValidation";

describe("validateExpiryDate", () => {
  let mockDate: Date;

  beforeEach(() => {
    mockDate = new Date("2024-01-15T12:00:00.000Z");
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("valid dates", () => {
    test("returns valid for future date in YYYY/MM/DD format", () => {
      const result = validateExpiryDate("2024/02/01");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });

    test("returns valid for future date in YYYY-MM-DD format", () => {
      const result = validateExpiryDate("2024-02-01");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });

    test("returns valid for today's date", () => {
      const result = validateExpiryDate("2024/01/15");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });

    test("handles leap year correctly", () => {
      const result = validateExpiryDate("2024/02/29");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });
  });

  describe("invalid dates - past dates", () => {
    test("returns invalid for past date", () => {
      const result = validateExpiryDate("2024/01/10");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Expiry date must be in the future");
    });

    test("returns invalid for previous year", () => {
      const result = validateExpiryDate("2023/12/31");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Expiry date must be in the future");
    });
  });

  describe("invalid dates - format errors", () => {
    test("returns invalid for empty string", () => {
      const result = validateExpiryDate("");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Expiry date is required");
    });

    test("returns invalid for undefined", () => {
      const result = validateExpiryDate(undefined);
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Expiry date is required");
    });

    test("returns invalid for whitespace only", () => {
      const result = validateExpiryDate("   ");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Expiry date is required");
    });

    test("returns invalid for single date component", () => {
      const result = validateExpiryDate("2024");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Invalid date format");
    });

    test("returns invalid for two date components", () => {
      const result = validateExpiryDate("2024/02");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Invalid date format");
    });

    test("returns invalid for non-numeric components", () => {
      const result = validateExpiryDate("YYYY/MM/DD");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Invalid date format");
    });
  });

  describe("DST scenarios", () => {
    test("handles dates during DST transition (spring forward)", () => {
      const result = validateExpiryDate("2024/03/15");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });

    test("handles DST boundary dates correctly", () => {
      const dstBoundaryDate = new Date("2024-03-09T10:00:00.000Z");
      vi.setSystemTime(dstBoundaryDate);
      const result = validateExpiryDate("2024/03/11");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });
  });

  describe("leap year scenarios", () => {
    test("validates leap year February 29th correctly", () => {
      const result = validateExpiryDate("2024/02/29");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });

    test("handles non-leap year February 29th (auto-corrects to March 1)", () => {
      const result = validateExpiryDate("2023/02/29");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Expiry date must be in the future");
    });

    test("handles leap year boundaries correctly", () => {
      const feb28LeapYear = new Date("2024-02-28T10:00:00.000Z");
      vi.setSystemTime(feb28LeapYear);
      const result = validateExpiryDate("2024/02/29");
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });
  });
});
