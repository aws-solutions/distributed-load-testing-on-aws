// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ValidationResult } from "./validationTypes";

const MAX_URI_LENGTH = 2048;

/**
 * Validates that a string is a structurally valid URI.
 *
 * Uses the built-in URL constructor which implements RFC 3986 parsing.
 * Requires a scheme (e.g. http://, https://, ws://, ftp://) and an authority/host.
 *
 * @param value - The string to validate
 * @returns ValidationResult with isValid boolean and errorMessage string
 */
export const isValidUri = (value: string): ValidationResult => {
  if (!value || !value.trim()) {
    return { isValid: false, errorMessage: "HTTP endpoint is required" };
  }

  if (value.length > MAX_URI_LENGTH) {
    return { isValid: false, errorMessage: `URI must not exceed ${MAX_URI_LENGTH} characters` };
  }

  try {
    const url = new URL(value);
    // URL constructor accepts some edge cases we want to reject:
    // - Must have a real host (not just a scheme like "http://")
    if (!url.hostname) {
      return { isValid: false, errorMessage: "URI must include a valid host" };
    }
    return { isValid: true, errorMessage: "" };
  } catch {
    return { isValid: false, errorMessage: "URI must be a valid format (e.g. http://www.example.com)" };
  }
};