// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { isCronValid, validateCronFields } from "../../utils/cronValidation";

/**
 * Cron validation contract tests.
 *
 * These test cases define the contract between the frontend validation
 * (cronValidation.ts) and the API-side regex (api-services/lib/validation/schemas.ts).
 * Both must accept and reject the same expressions.
 *
 * If the API schema changes what it accepts, the corresponding API-side tests
 * (schemas.spec.ts) should be updated, and these frontend tests should be
 * updated to match. The test cases themselves are the contract — no regex copy needed.
 */

describe("Cron Validation", () => {
  describe("valid expressions (must be accepted)", () => {
    const validCases = [
      { desc: "every hour", fields: { cronMinutes: "0", cronHours: "*", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "daily at 9AM", fields: { cronMinutes: "0", cronHours: "9", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "weekdays at 8AM", fields: { cronMinutes: "0", cronHours: "8", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "1-5" } },
      { desc: "sunday at 5PM", fields: { cronMinutes: "0", cronHours: "17", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "0" } },
      { desc: "1st of month at 11AM", fields: { cronMinutes: "0", cronHours: "11", cronDayOfMonth: "1", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "minute 59", fields: { cronMinutes: "59", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "hour step */2", fields: { cronMinutes: "0", cronHours: "*/2", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "hour list 9,17", fields: { cronMinutes: "0", cronHours: "9,17", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day 31", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "31", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "month 12", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "12", cronDayOfWeek: "*" } },
      { desc: "day of week range 0,6", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "0,6" } },
      { desc: "day of week 6", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "6" } },
    ];

    for (const { desc, fields } of validCases) {
      test(desc, () => {
        expect(isCronValid(fields)).toBe(true);
      });
    }
  });

  describe("invalid expressions (must be rejected)", () => {
    const invalidCases = [
      { desc: "minutes abc", fields: { cronMinutes: "abc", cronHours: "9", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "minutes 60", fields: { cronMinutes: "60", cronHours: "9", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "minutes step */15", fields: { cronMinutes: "*/15", cronHours: "*", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "hours 24", fields: { cronMinutes: "0", cronHours: "24", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "hours 99", fields: { cronMinutes: "0", cronHours: "99", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day of month 0", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "0", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day of month 00", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "00", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day of month 32", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "32", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day of month range 1,15", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "1,15", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "month 0", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "0", cronDayOfWeek: "*" } },
      { desc: "month 13", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "13", cronDayOfWeek: "*" } },
      { desc: "month list 1,6", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "1,6", cronDayOfWeek: "*" } },
      { desc: "day of week 7", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "7" } },
      { desc: "day of week 8", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "8" } },
      { desc: "question mark ?", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "?", cronMonth: "*", cronDayOfWeek: "*" } },
    ];

    for (const { desc, fields } of invalidCases) {
      test(desc, () => {
        expect(isCronValid(fields)).toBe(false);
      });
    }
  });

  describe("error messages", () => {
    test("valid expression returns empty string", () => {
      expect(validateCronFields({ cronMinutes: "0", cronHours: "*", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" })).toBe("");
    });

    test("invalid minutes", () => {
      expect(validateCronFields({ cronMinutes: "abc", cronHours: "*", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" }))
        .toBe("Minutes must be a single value (0-59). Step values and lists are not supported.");
    });

    test("invalid hours", () => {
      expect(validateCronFields({ cronMinutes: "0", cronHours: "25", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" }))
        .toBe("Hours must be *, a value (0-23), a step value (*/N), or a comma-separated list.");
    });

    test("invalid day of month", () => {
      expect(validateCronFields({ cronMinutes: "0", cronHours: "0", cronDayOfMonth: "1,15", cronMonth: "*", cronDayOfWeek: "*" }))
        .toBe("Day of month must be * or a single value (1-31). Ranges and lists are not supported.");
    });

    test("invalid month", () => {
      expect(validateCronFields({ cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "13", cronDayOfWeek: "*" }))
        .toBe("Month must be * or a single value (1-12). Ranges and lists are not supported.");
    });

    test("invalid day of week", () => {
      expect(validateCronFields({ cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "8" }))
        .toBe("Day of week must be *, a value (0-6), or a range/list (e.g., 1-5, 0,6).");
    });
  });
});
