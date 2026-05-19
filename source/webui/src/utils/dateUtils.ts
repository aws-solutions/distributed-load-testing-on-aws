// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Formats a date string to browser local time.
 *
 * When no sourceTimezone is provided the string is treated as UTC
 * (legacy behaviour — used for startTime, endTime, etc.).
 *
 * When sourceTimezone is an IANA timezone name the string is treated
 * as a wall-clock time in that timezone (used for nextRun).
 *
 * @param dateString - Date string from backend (YYYY-MM-DD HH:MM:SS)
 * @param options - Intl.DateTimeFormatOptions for formatting
 * @param sourceTimezone - IANA timezone the dateString is expressed in.
 *                         Omit or pass undefined to treat as UTC.
 * @returns Formatted date string in browser's local timezone
 */
export const formatToLocalTime = (
  dateString?: string,
  options?: Intl.DateTimeFormatOptions,
  sourceTimezone?: string,
): string => {
  if (!dateString) return "-";

  let date: Date;
  if (sourceTimezone) {
    // Build a Date by interpreting dateString in the given timezone.
    const isoish = dateString.replace(" ", "T");
    const rough = new Date(isoish + "Z");
    if (isNaN(rough.getTime())) return "-";

    // Determine the offset between UTC and the source timezone at this instant
    const utcStr = rough.toLocaleString("en-US", { timeZone: "UTC" });
    const tzStr = rough.toLocaleString("en-US", { timeZone: sourceTimezone });
    const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();

    date = new Date(rough.getTime() + offsetMs);
  } else {
    date = new Date(dateString + "Z");
  }

  return isNaN(date.getTime()) ? "-" : date.toLocaleString(undefined, options);
};
