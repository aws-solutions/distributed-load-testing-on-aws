// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Formats a UTC date string to browser local time
 * @param utcDateString - UTC date string from backend (YYYY-MM-DD HH:MM:SS)
 * @param options - Intl.DateTimeFormatOptions for formatting
 * @returns Formatted date string in browser's local timezone
 */
export const formatToLocalTime = (
  utcDateString?: string,
  options?: Intl.DateTimeFormatOptions
): string => {
  if (!utcDateString) return "-";
  
  const date = new Date(utcDateString + 'Z');
  return isNaN(date.getTime()) ? "-" : date.toLocaleString(undefined, options);
};