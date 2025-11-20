// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Generates a unique ID based on the parameter length.
 *
 * @param length - The length of the unique ID (default: 10)
 * @returns The unique ID as a string
 */
export const generateUniqueId = (length = 10) => {
  const ALPHA_NUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => ALPHA_NUMERIC[Math.floor(Math.random() * ALPHA_NUMERIC.length)]).join("");
};
