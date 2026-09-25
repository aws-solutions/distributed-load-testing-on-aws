// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical parsing/validation for simple numeric CLI flags.
 *
 * Centralizing these keeps the accepted format — and its error message —
 * identical across every command that takes the same kind of value, so the
 * validation cannot drift between the create, update, and query paths.
 */

/**
 * Parse a flag that must be a positive integer (1, 2, 3, …), throwing a clear,
 * flag-named error otherwise. Zero, negatives, decimals, and non-numeric input
 * are all rejected so a bad value fails locally instead of being sent to the
 * API as `NaN` or a degenerate value.
 * @param input The raw flag value.
 * @param label The flag name to reference in the error (e.g. `--concurrency`).
 */
export function parsePositiveInt(input: string, label: string): number {
  if (!/^[1-9]\d*$/.test(input.trim())) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number.parseInt(input, 10);
}
