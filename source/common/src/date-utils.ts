// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

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
