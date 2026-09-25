// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Requires text that can be encoded and decoded without replacing invalid Unicode. */
export function assertWellFormedString(value: unknown, field: string, allowEmpty: boolean): asserts value is string {
  if (typeof value !== "string" || !value.isWellFormed() || (!allowEmpty && value === "")) {
    const emptyRule = allowEmpty ? "" : " nonempty";
    throw new TypeError(`${field} must be a${emptyRule} well-formed Unicode string.`);
  }
}

/**
 * Orders text by encoded UTF-8 bytes so every reducer language writes the same
 * label and response-code order.
 */
export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
