// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ValidationResult } from "./validationTypes";
import { DateTime } from "luxon";

/** @deprecated Use ValidationResult instead */
export type ExpiryDateValidation = ValidationResult;

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
 * @returns {Date | null} Returns a `Date` at the end of the specified date in the specified timezone or `null` if it couldn't be parsed
 */
export function parseExpiryDate(expiryDate: string, scheduleTimezone: string | undefined): Date | null {
  const zone = scheduleTimezone || "UTC";
  const dateParts = splitDateParts(expiryDate.trim());
  if (!dateParts) {
    return null;
  }

  const { year, month, day } = dateParts;

  const date = DateTime.local(year, month, day, 23, 59, 59, 999, { zone });
  if (date.isValid) {
    return date.toJSDate();
  }
  return null;
}

/**
 * Validates the expiry date is in the future if defined
 *
 * @param {string | undefined} cronExpiryDate The date in format `"yyyy-mm-dd"` or `"yyyy/mm/dd"`
 * @param {string | undefined} scheduleTimezone The timezone for the date.
 * @returns {ValidationResult} A validation result
 */
export function validateExpiryDate(cronExpiryDate: string | undefined, scheduleTimezone: string | undefined = "UTC"): ValidationResult {
  if (!cronExpiryDate?.trim()) {
    return { isValid: false, errorMessage: "Expiry date is required" };
  }

  try {
    const expiryDate = parseExpiryDate(cronExpiryDate, scheduleTimezone);
    if (!expiryDate) {
      return { isValid: false, errorMessage: "Invalid date format" };
    }
    const today = new Date();

    if (expiryDate < today) {
      return { isValid: false, errorMessage: "Expiry date must be in the future" };
    }

    return { isValid: true, errorMessage: "" };
  } catch {
    return { isValid: false, errorMessage: "Invalid date format" };
  }
}

/*
 * Checks whether the schedule date and time are in the future
 *
 * @param {string | undefined} scheduleDate The date in format `"yyyy-mm-dd"`
 * @param {string | undefined} scheduleTime The time in format `"HH:MM"`
 * @param {string | undefined} scheduleTimezone The time zone for the schedule
 * @returns {boolean} Returns `true` if the schedule is in the future or not specified
 */
export function checkScheduleInFuture(scheduleDate: string | undefined, scheduleTime: string | undefined, scheduleTimezone: string | undefined): boolean {
  if (!scheduleDate || !scheduleTime) return true;
  const zone = scheduleTimezone || "UTC";
  const scheduled = DateTime.fromISO(`${scheduleDate}T${scheduleTime}`, { zone });
  if (!scheduled.isValid) return true;
  return scheduled > DateTime.now().setZone(zone);
}
