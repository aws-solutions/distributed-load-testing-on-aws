// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Requires an integer that JavaScript can add without rounding.
 *
 * Counts use this stricter rule because one lost request could move a
 * percentile rank. Native mode's raw-output budget keeps real request counts
 * thousands of times below Number.MAX_SAFE_INTEGER.
 */
export function assertSafeNonnegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a nonnegative safe integer.`);
  }
}

/** Requires a safe count greater than zero. */
export function assertPositiveSafeInteger(value: unknown, field: string): asserts value is number {
  assertSafeNonnegativeInteger(value, field);
  if (value === 0) throw new RangeError(`${field} must be greater than zero.`);
}

/**
 * Adds already-validated counts and rejects the result before precision could
 * be lost.
 */
export function addSafeIntegers(left: number, right: number, field: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${field} exceeds JavaScript's exact integer range.`);
  }
  return sum;
}

/**
 * Requires a nonnegative integer that may be larger than the exact-integer
 * range.
 *
 * This is reserved for byte telemetry. Above roughly 9 PB a JavaScript number
 * advances in increments of multiple bytes, which is acceptable for reporting
 * but not for request or histogram counts.
 */
export function assertNonnegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a finite nonnegative integer.`);
  }
}

/** Adds already-validated byte totals and rejects a non-finite result. */
export function addNonnegativeIntegers(left: number, right: number, field: string): number {
  const sum = left + right;
  if (!Number.isFinite(sum)) throw new RangeError(`${field} exceeds JavaScript's finite number range.`);
  return sum;
}

/** Requires a finite number inside an inclusive range. */
export function assertFiniteNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be a finite number between ${minimum} and ${maximum}.`);
  }
}
