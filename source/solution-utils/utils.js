// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { customAlphabet } = require("nanoid");

/**
 * Generates an unique ID based on the parameter length.
 * @param length The length of the unique ID
 * @returns The unique ID
 */
const generateUniqueId = (length = 10) => {
  const ALPHA_NUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const nanoid = customAlphabet(ALPHA_NUMERIC, length);
  return nanoid();
};

/**
 * Sets the customUserAgent if SOLUTION_ID and SOLUTION_VERSION are provided as environment variables.
 * @param options An object, can be empty {}
 * @returns The options object with customUserAgent set if environment variables exist
 */

const getOptions = (options) => {
  const { SOLUTION_ID, SOLUTION_VERSION } = process.env;
  if (SOLUTION_ID && SOLUTION_VERSION) {
    if (SOLUTION_ID.trim() !== "" && SOLUTION_VERSION.trim() !== "") {
      options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${SOLUTION_VERSION}`;
    }
  }

  return options;
};

module.exports = {
  generateUniqueId: generateUniqueId,
  getOptions: getOptions,
};
