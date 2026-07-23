// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { formatDate, getCurrentDateFormatted, timezoneAwareNow, parseExpiryDate, parseISODate } from "../src/date-utils";

describe("date-utils", () => {
  describe("formatDate", () => {
    it("should format a date in yyyy-mm-dd hh:mm:ss format", () => {
      const date = new Date("2026-04-15T12:30:45.123Z");
      expect(formatDate(date)).toBe("2026-04-15 12:30:45");
    });

    it("should replace T separator with a space", () => {
      const date = new Date("2024-01-01T00:00:00.000Z");
      expect(formatDate(date)).toBe("2024-01-01 00:00:00");
    });

    it("should strip milliseconds and trailing Z", () => {
      const date = new Date("2025-12-31T23:59:59.999Z");
      expect(formatDate(date)).toBe("2025-12-31 23:59:59");
    });

    it("should handle midnight correctly", () => {
      const date = new Date("2024-06-15T00:00:00.000Z");
      expect(formatDate(date)).toBe("2024-06-15 00:00:00");
    });

    it("should handle end-of-day correctly", () => {
      const date = new Date("2024-03-10T23:59:59.000Z");
      expect(formatDate(date)).toBe("2024-03-10 23:59:59");
    });
  });

  describe("getCurrentDateFormatted", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return current date in yyyy-mm-dd hh:mm:ss format", () => {
      const fixedDate = new Date("2026-07-01T14:30:00.000Z");
      vi.setSystemTime(fixedDate);
      expect(getCurrentDateFormatted()).toBe("2026-07-01 14:30:00");
      vi.useRealTimers();
    });

    it("should return a string matching the expected format", () => {
      const result = getCurrentDateFormatted();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("timezone-aware", () => {

    beforeEach(() => {
      vi.stubEnv("TZ", "America/Los_Angeles");
      vi.setSystemTime(Date.UTC(2026, 2, 5, 23, 0, 0, 0)); // Mar 5, 2026 at 3:00 PM PST
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });

    it("getCurrentDateFormatted", () => {
      expect(getCurrentDateFormatted()).toBe("2026-03-05 23:00:00");
    });

    it.each([
      [ "America/New_York", "2026-03-05T18:00:00.000-05:00" ],
      [ "America/Los_Angeles", "2026-03-05T15:00:00.000-08:00" ],
      [ "UTC", "2026-03-05T23:00:00.000Z" ],
      [ "", "2026-03-05T23:00:00.000Z" ],
      [ undefined, "2026-03-05T23:00:00.000Z" ],
    ])("timezoneAwareNow('%s') -> %s", (timezone: string | undefined, expected: string) => {
      expect(String(timezoneAwareNow(timezone))).toBe(expected);
    });

    it.each([
      [ "2026-06-03", "America/New_York", "2026-06-03T23:59:59.999-04:00" ],
      [ "2026/06/03", undefined, "2026-06-03T23:59:59.999Z" ],
      [ "2026-06-03", "", "2026-06-03T23:59:59.999Z" ],
      [ "2026-06", "America/New_York", "null" ],
      [ "2026-02-30", "America/New_York", "null" ],
      [ "2026-june-03", "America/New_York", "null" ],
      [ "--", "America/New_York", "null" ],
    ])("parseExpiryDate('%s', '%s') -> %s", (expiryDate: string, scheduleTimezone: string | undefined, expected: string) => {
      expect(String(parseExpiryDate(expiryDate, scheduleTimezone))).toBe(expected);
    });

    it.each([
      [ "2026-06-03T08:30", "America/New_York", "2026-06-03T08:30:00.000-04:00" ],
      [ "2026-06-03T08:30", "America/Los_Angeles", "2026-06-03T08:30:00.000-07:00" ],
      [ "2026-06-03T08:30", undefined, "2026-06-03T08:30:00.000Z" ],
      [ "2026-06-03T08:30", "", "2026-06-03T08:30:00.000Z" ],
      [ "2026-06-03T08:30", "UTC", "2026-06-03T08:30:00.000Z" ],
    ])("parseISODate('%s', '%s') -> %s", (text: string, scheduleTimezone: string | undefined, expected: string) => {
      expect(String(parseISODate(text, scheduleTimezone))).toBe(expected);
    });

  });

});
