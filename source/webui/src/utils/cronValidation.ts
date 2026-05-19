// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Cron field validation rules matching the API-side regex in api-services/lib/validation/schemas.ts.
 * Supported: minute (single value 0-59), hour (with step values and comma lists),
 * day-of-month (single value 1-31), month (single value 1-12), day-of-week (with ranges and lists).
 */

const MINUTES_REGEX = /^[0-5]?\d$/;
const HOURS_REGEX = /^(\*|\*\/\d+|([01]?\d|2[0-3])(,([01]?\d|2[0-3]))*)$/;
const DAY_OF_MONTH_REGEX = /^(\*|[1-9]|[12]\d|3[01])$/;
const MONTH_REGEX = /^(\*|[1-9]|1[0-2])$/;
const DAY_OF_WEEK_REGEX = /^(\*|[0-6]([-,][0-6])*)$/;

export interface CronFields {
  cronMinutes: string;
  cronHours: string;
  cronDayOfMonth: string;
  cronMonth: string;
  cronDayOfWeek: string;
}

/**
 * Validates individual cron fields and returns a field-specific error message.
 * Returns empty string if all fields are valid.
 */
export function validateCronFields(fields: CronFields): string {
  const { cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek } = fields;

  if (!MINUTES_REGEX.test(cronMinutes)) {
    return "Minutes must be a single value (0-59). Step values and lists are not supported.";
  }
  if (!HOURS_REGEX.test(cronHours)) {
    return "Hours must be *, a value (0-23), a step value (*/N), or a comma-separated list.";
  }
  const dayOfMonth = cronDayOfMonth || "*";
  if (!DAY_OF_MONTH_REGEX.test(dayOfMonth)) {
    return "Day of month must be * or a single value (1-31). Ranges and lists are not supported.";
  }
  const month = cronMonth || "*";
  if (!MONTH_REGEX.test(month)) {
    return "Month must be * or a single value (1-12). Ranges and lists are not supported.";
  }
  const dayOfWeek = cronDayOfWeek || "*";
  if (!DAY_OF_WEEK_REGEX.test(dayOfWeek)) {
    return "Day of week must be *, a value (0-6), or a range/list (e.g., 1-5, 0,6).";
  }

  return "";
}

/**
 * Returns true if all cron fields pass validation.
 */
export function isCronValid(fields: CronFields): boolean {
  return validateCronFields(fields) === "";
}
