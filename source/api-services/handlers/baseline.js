// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");

const handleBaseline = async (method, resource, errorMsg, testId, config, queryParams, userAgent) => {
  switch (method) {
    case "GET": {
      // GET /scenarios/{testId}/baseline[?data=false] - data is true by default
      const includeData = !queryParams || queryParams.data !== "false";
      try {
        await utils.sendMetric({
          Type: "GetBaseline",
          TestId: testId,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.getBaseline(testId, includeData);
    }
    case "PUT":
      try {
        await utils.sendMetric({
          Type: "SetBaseline",
          TestId: testId,
          TestRunId: config.testRunId,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.setBaseline(testId, config.testRunId);
    case "DELETE":
      try {
        await utils.sendMetric({
          Type: "ClearBaseline",
          TestId: testId,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.clearBaseline(testId);
    default:
      throw errorMsg;
  }
};

module.exports = { handleBaseline };
