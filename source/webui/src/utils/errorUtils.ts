// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Extracts a user-friendly error message from API errors
 * Specifically handles AWS Amplify API error structures
 */
const ERROR_PATTERNS = [
  { prefix: "InvalidParameter:", replacement: "" },
  { prefix: "INVALID_REQUEST_BODY:", replacement: "Invalid request:" },
  { prefix: "ValidationException:", replacement: "Validation error:" },
  { prefix: "ResourceNotFoundException:", replacement: "Resource not found:" },
  { prefix: "AccessDeniedException:", replacement: "Access denied:" },
  { prefix: "InternalServerError:", replacement: "Server error:" },
  { prefix: "BadRequestException:", replacement: "Bad request:" },
];

export function extractErrorMessage(error: any): string {
  const message =
    error?.response?.body ||
    error?.data?.message ||
    error?.error ||
    (error?.message !== "Unknown error" ? error?.message : null) ||
    (typeof error === "string" ? error : null) ||
    "An unexpected error occurred. Please try again.";

  // Format message by removing technical prefixes
  const pattern = ERROR_PATTERNS.find((p) => message.startsWith(p.prefix));
  if (pattern) {
    const cleanMessage = message.replace(pattern.prefix, "").trim();
    return pattern.replacement ? `${pattern.replacement} ${cleanMessage}` : cleanMessage;
  }

  return message;
}
