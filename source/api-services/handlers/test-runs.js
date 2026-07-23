// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");

const handleTestRuns = async (method, resource, errorMsg, testId, queryParams, body, userAgent) => {
  if (method === "GET") {
    try {
      await utils.sendMetric({
        Type: "GetTestRuns",
        TestId: testId,
        UserAgent: userAgent,
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return scenarios.getTestRuns(testId, queryParams);
  }
  if (method === "DELETE") {
    try {
      await utils.sendMetric({
        Type: "DeleteTestRuns",
        TestId: testId,
        UserAgent: userAgent,
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return scenarios.deleteTestRuns(testId, body);
  }
  throw errorMsg;
};

module.exports = { handleTestRuns };
