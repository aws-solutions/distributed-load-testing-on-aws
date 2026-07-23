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
      { desc: "complex list of hours 1-3,4-9/2,12-22/3,*/10", fields: { cronMinutes: "0", cronHours: "1-3,4-9/2,12-22/3,*/10", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "0" } },
      { desc: "1st of month at 11AM", fields: { cronMinutes: "0", cronHours: "11", cronDayOfMonth: "1", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day of month list 1,15", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "1,15", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day of month range 2-15", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "2-15", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day of month range 4-15 every 3rd day", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "4-15/3", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "question mark ?", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "?", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "First and last day of month", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "1,L", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "minute 59", fields: { cronMinutes: "59", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "hour step */2", fields: { cronMinutes: "0", cronHours: "*/2", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "hour list 9,17", fields: { cronMinutes: "0", cronHours: "9,17", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "day 31", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "31", cronMonth: "*", cronDayOfWeek: "*" } },
      { desc: "month 12", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "12", cronDayOfWeek: "*" } },
      { desc: "month list 1,6", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "1,6", cronDayOfWeek: "*" } },
      { desc: "every other month in range 3-7", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "3-7/2", cronDayOfWeek: "*" } },
      { desc: "month range by name mar-sep", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "mar-sep", cronDayOfWeek: "*" } },
      { desc: "month range by name MAR-SEP", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "MAR-SEP", cronDayOfWeek: "*" } },
      { desc: "day of week list 0,6", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "0,6" } },
      { desc: "day of week range 0-6", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "0-6" } },
      { desc: "day of week 6", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "6" } },
      { desc: "day of week range by name", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "mon-fri" } },
      { desc: "day of week range by name", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "MON-FRI" } },
      { desc: "every third tuesday of the month", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "2#3" } },
      { desc: "every third tuesday by name", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "tue#3" } },
      { desc: "First and last day of week", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "0,L" } },
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
      { desc: "month 0", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "0", cronDayOfWeek: "*" } },
      { desc: "month 13", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "13", cronDayOfWeek: "*" } },
      { desc: "day of week 7", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "7" } },
      { desc: "day of week 8", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "8" } },
      { desc: "only one expression allowed when using '#' in day of week", fields: { cronMinutes: "0", cronHours: "0", cronDayOfMonth: "*", cronMonth: "*", cronDayOfWeek: "2#3,5" } },
    ];

    for (const { desc, fields } of invalidCases) {
      test(desc, () => {
        expect(isCronValid(fields)).toBe(false);
      });
    }
  });

  describe("error messages", () => {

    test.each([
      [ "valid expression returns empty string", "30", "1-3,4-9/2,12-22/3,*/10", "?", "Feb-May/2,Sep", "1#3", "" ],
      [ "invalid minutes", "5,10", "*", "*", "*", "*", "Minutes must be a single value (0-59). Step values and lists are not supported." ],
      [ "invalid minutes", "abc", "*", "*", "*", "*", "Invalid characters, got value: abc" ],
      [ "invalid hours",  "0", "25", "*", "*", "*" , "Constraint error, got value 25 expected range 0-23" ],
      [ "invalid day of month", "0", "0", "32", "*", "*", "Constraint error, got value 32 expected range 1-31" ],
      [ "invalid month", "0", "0", "*", "13", "*", "Constraint error, got value 13 expected range 1-12" ],
      [ "invalid day of week", "0", "0", "*", "*", "8", "Constraint error, got value 8 expected range 0-7" ],
      [ "does not support 'H' day-of-week", "0", "0", "*", "*", "H", "Day of week must be *, ?, L, a value (0-6), name prefix (SUN-SAT), or a range/list (e.g., 1-5, 0,6)." ],
      [ "does not support 'H' month", "0", "0", "*", "H", "*", "Month must be *, a value (1-12), name prefix (JAN-DEC), or a range/list (e.g., 1-5, 1,5). Use '/N' to increment by N." ],
      [ "does not support 'H' day-of-month", "0", "0", "H", "*", "*", "Day of month must be *, ?, L, a value (1-31), or a range/list (e.g., 1-5, 1,5). Use '/N' to increment by N." ],
      [ "does not support 'H' hour", "0", "H", "*", "*", "*", "Hours must be *, a value (0-23), a step value (*/N or h/N), or a comma-separated list." ],
    ])("%s: '%s %s %s %s %s'", (description: string,  cronMinutes: string, cronHours: string, cronDayOfMonth: string, cronMonth: string, cronDayOfWeek: string, expected: string) => {
      expect(!description).toBe(false)
      expect(validateCronFields({ cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek })).toBe(expected);
    });

  });
});
