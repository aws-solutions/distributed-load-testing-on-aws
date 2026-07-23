// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DateTime } from "luxon";

/**
 * Converts a Date to a UTC timestamp string in `yyyy-mm-dd hh:mm:ss` format.
 * The standard ISO 8601 `T` separator between date and time is replaced with a
 * space, and the milliseconds and trailing `Z` are stripped.
 *
 * Example: `new Date("2026-04-15T12:30:45.123Z")` returns `"2026-04-15 12:30:45"`.
 * @param {Date} date date to format
 */
export function formatDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/**
 * 
 * @returns {string} return current date formatted as yyyy-mm-dd hh:mm:ss
 */
export function getCurrentDateFormatted(): string {
    return formatDate(new Date());
}

/**
 * @returns {DateTime} return a `DateTime` object for "now" in the specified timezone
 */
export function timezoneAwareNow(timezone: string = "UTC"): DateTime {
  const zone = timezone || "UTC";
  return DateTime.local({ zone });
}

/**
 * Splits `"yyyy-mm-dd"` or `"yyyy/mm/dd"` into `{ year: yyyy, month: mm, day: dd }`
 *
 * @param {string} dateExpression Date in format `"yyyy-mm-dd"` or `"yyyy/mm/dd"`
 * @returns {object} return `{ year: yyyy, month: mm, day: dd }` or `null`
 */
function splitDateParts(dateExpression: string): { year: number, month: number, day: number } | null {
  const dateParts = dateExpression.split(/[-/]/);
  if (dateParts.length !== 3) {
    return null;
  }

  const year = Number.parseInt(dateParts[0] || "");
  const month = Number.parseInt(dateParts[1] || "");
  const day = Number.parseInt(dateParts[2] || "");

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }

  return { year, month, day };
}

/**
 * Parse date string in format `"yyyy-mm-dd"` or `"yyyy/mm/dd"` into a `Date` with
 * the time set at the end of the day in the specified timezone.
 *
 * @param {string} expiryDate date in format `"yyyy-mm-dd"` or `"yyyy/mm/dd"`
 * @param {string | undefined} scheduleTimezone The timezone for the date.
 * @returns {DateTime | null} Returns a `DateTime` at the end of the specified date in the specified timezone or `null` if it couldn't be parsed
 */
export function parseExpiryDate(expiryDate: string = "", scheduleTimezone: string = "UTC"): DateTime | null {
  const zone = scheduleTimezone || "UTC";
  const dateParts = splitDateParts(expiryDate.trim());
  if (dateParts) {
    const { year, month, day } = dateParts;
    const date = DateTime.local(year, month, day, 23, 59, 59, 999, { zone });
    if (date.isValid) {
      return date;
    }
  }

  return null;
}

/**
 * Parse date in ISO format in the specified timezone.
 *
 * @param {string} text The ISO format date.
 * @param {string | undefined} scheduleTimezone The timezone for the date.
 * @returns {DateTime} Returns a `DateTime` object.
 */
export function parseISODate(text: string, scheduleTimezone: string = "UTC"): DateTime {
  const zone = scheduleTimezone || "UTC";
  return DateTime.fromISO(text, { zone });
}
