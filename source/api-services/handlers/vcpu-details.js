// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");

const handleVCPUDetails = async (method, resource, errorMsg, userAgent) => {
  if (method === "GET") {
    try {
      await utils.sendMetric({
        Type: "GetVCPUDetails",
        UserAgent: userAgent,
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return scenarios.getAccountFargatevCPUDetails();
  }
  throw errorMsg;
};

module.exports = { handleVCPUDetails };
