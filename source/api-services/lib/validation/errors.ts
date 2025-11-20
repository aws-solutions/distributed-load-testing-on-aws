// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ZodError, ZodIssue } from "zod";

/**
 * Error transformation utilities for converting Zod errors to API errors
 */

/**
 * Helper function to format path with array notation
 *
 * @param {(string | number)[]} path - The path array to format with array notation
 * @returns {string} The formatted path string with array notation
 */
function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "value";

  return path.reduce((acc, segment, index) => {
    if (index === 0) {
      return String(segment);
    }
    if (typeof segment === "number") {
      return `${acc}[${segment}]`;
    }
    return `${acc}.${String(segment)}`;
  }, "" as string);
}

/**
 * Formats a Zod error into a user-friendly error message
 *
 * @param {ZodError} error - The Zod error to format
 * @returns {string} A user-friendly error message string
 */
export function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue: ZodIssue) => {
    const path = formatPath(issue.path);
    return `${path}: ${issue.message}`;
  });

  return issues.join("; ");
}

/**
 * Extracts the first error message from a Zod error
 *
 * @param {ZodError} error - The Zod error to extract the first message from
 * @returns {string} The first error message or default message
 */
export function getFirstZodError(error: ZodError): string {
  if (error.issues.length === 0) {
    return "Validation failed";
  }

  const issue = error.issues[0];
  return issue.message;
}

/**
 * Groups Zod issues by field path
 *
 * @param {ZodIssue[]} issues - Array of Zod issues to group by path
 * @returns {Record<string, string[]>} Object with field paths as keys and error messages as values
 */
export function groupZodIssuesByPath(issues: ZodIssue[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};

  issues.forEach((issue: ZodIssue) => {
    const path = formatPath(issue.path) || "root";
    if (!grouped[path]) {
      grouped[path] = [];
    }
    grouped[path].push(issue.message);
  });

  return grouped;
}

/**
 * Converts Zod issues to a structured validation error list
 *
 * @param {ZodIssue[]} issues - Array of Zod issues to convert
 * @returns {Array} Array of validation error objects with field, message, code, and path properties
 */
export function zodIssuesToValidationErrors(issues: ZodIssue[]) {
  return issues.map((issue: ZodIssue) => ({
    field: formatPath(issue.path) || "root",
    message: issue.message,
    code: issue.code,
    path: issue.path,
  }));
}
