// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Returns the value of the specified environment variable, or throws a
 * descriptive error if it is not set or is empty.
 *
 * This avoids the common pattern of unchecked `process.env.FOO!` access
 * scattered across Lambda handlers, which fails silently at runtime.
 *
 * @example
 * ```ts
 * const table = getRequiredEnv("SCENARIOS_TABLE");
 * const bucket = getRequiredEnv("SCENARIOS_BUCKET");
 * ```
 *
 * @param name - The environment variable name
 * @returns The trimmed, non-empty value
 * @throws {Error} If the variable is not set or is blank
 */
export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable "${name}" is not set or is empty`);
  }
  return value;
}
