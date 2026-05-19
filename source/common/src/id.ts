// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { customAlphabet } from "nanoid";

const ALPHA_NUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generates a unique alphanumeric ID of the specified length.
 *
 * @param length - The length of the generated ID (default: 10)
 * @returns A random alphanumeric string
 */
export function generateUniqueId(length = 10): string {
  const nanoid = customAlphabet(ALPHA_NUMERIC, length);
  return nanoid();
}
