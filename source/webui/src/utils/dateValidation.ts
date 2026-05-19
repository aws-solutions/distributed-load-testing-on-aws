// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ValidationResult } from "./validationTypes";

/** @deprecated Use ValidationResult instead */
export type ExpiryDateValidation = ValidationResult;

export function validateExpiryDate(cronExpiryDate: string | undefined): ValidationResult {
  if (!cronExpiryDate?.trim()) {
    return { isValid: false, errorMessage: "Expiry date is required" };
  }

  try {
    const dateParts = cronExpiryDate.split(/[-/]/);
    if (dateParts.length !== 3) {
      return { isValid: false, errorMessage: "Invalid date format" };
    }

    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]);
    const day = parseInt(dateParts[2]);

    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return { isValid: false, errorMessage: "Invalid date format" };
    }

    const expiryDate = new Date(year, month - 1, day, 23, 59, 59, 999);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (expiryDate < today) {
      return { isValid: false, errorMessage: "Expiry date must be in the future" };
    }

    return { isValid: true, errorMessage: "" };
  } catch {
    return { isValid: false, errorMessage: "Invalid date format" };
  }
}
