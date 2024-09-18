// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { customAlphabet } = require("nanoid");
const axios = require("axios");

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
 * Sets the customUserAgent if SOLUTION_ID and VERSION are provided as environment variables.
 * @param options An object, can be empty {}
 * @returns The options object with customUserAgent set if environment variables exist
 */

const getOptions = (options) => {
  options = options || {}; // Ensure options is an object
  const { SOLUTION_ID, VERSION } = process.env;
  if (SOLUTION_ID && VERSION) {
    if (SOLUTION_ID.trim() !== "" && VERSION.trim() !== "") {
      options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
    }
  }

  return options;
};

/**
 * Sends anonymized metrics.
 * @param {{ taskCount: number, testType: string, fileType: string|undefined }} - the number of containers used for the test, the test type, and the file type
 */
const sendMetric = async (metricData) => {
  let data;

  try {
    const metrics = {
      Solution: process.env.SOLUTION_ID,
      UUID: process.env.UUID,
      // Date and time instant in a java.sql.Timestamp compatible format
      TimeStamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
      Version: process.env.VERSION,
      Data: metricData,
    };
    const params = {
      method: "post",
      port: 443,
      url: process.env.METRIC_URL,
      headers: {
        "Content-Type": "application/json",
      },
      data: metrics,
    };
    data = await axios(params);
    return data.status;
  } catch (err) {
    console.error(err);
  }
};

module.exports = {
  generateUniqueId: generateUniqueId,
  getOptions: getOptions,
  sendMetric: sendMetric,
};
