// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");

const getRegions = async () => {
  let data = { regions: await scenarios.getAllRegionConfigs() };
  data.url = await scenarios.getCFUrl();
  return data;
};

const handleRegions = async (method, resource, errorMsg, userAgent) => {
  if (method === "GET") {
    try {
      await utils.sendMetric({
        Type: "GetRegions",
        UserAgent: userAgent,
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return getRegions();
  }
  throw errorMsg;
};

module.exports = { handleRegions, getRegions };
