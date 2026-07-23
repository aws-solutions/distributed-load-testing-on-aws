// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");

const handleStackInfo = async (method, resource, errorMsg, userAgent) => {
  if (method === "GET") {
    try {
      await utils.sendMetric({
        Type: "GetStackInfo",
        UserAgent: userAgent,
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return scenarios.getStackInfo();
  }
  throw errorMsg;
};

module.exports = { handleStackInfo };
