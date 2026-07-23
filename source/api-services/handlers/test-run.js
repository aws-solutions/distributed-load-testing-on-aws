// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");

const handleTestRun = async (method, resource, errorMsg, testId, testRunId, userAgent) => {
  if (method === "GET") {
    try {
      await utils.sendMetric({
        Type: "GetTestRun",
        TestId: testId,
        TestRunId: testRunId,
        UserAgent: userAgent,
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return scenarios.getTestRun(testId, testRunId);
  }
  throw errorMsg;
};

module.exports = { handleTestRun };
