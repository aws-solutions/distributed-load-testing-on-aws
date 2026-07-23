// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");

const handleScenarioWithTestId = async (method, resource, errorMsg, testId, config, functionName, queryParams, userAgent) => {
  switch (method) {
    case "GET":
      try {
        await utils.sendMetric({
          Type: "GetScenario",
          TestId: testId,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.getTest(testId, queryParams);
    case "POST": {
      const cancelResult = await scenarios.cancelTest(testId);
      try {
        await utils.sendMetric({
          Type: "CancelTest",
          TestId: testId,
          TestType: cancelResult.testType,
          RunDuration: cancelResult.runDuration,
          TasksLaunched: cancelResult.tasksLaunched,
          TasksCompleted: cancelResult.tasksCompleted,
          HadResults: cancelResult.hadResults ? "true" : "false",
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return cancelResult.status;
    }
    case "DELETE":
      try {
        const testRunCount = await scenarios.getTestRunCount(testId);
        await utils.sendMetric({
          Type: "DeleteTest",
          TestId: testId,
          TestRuns: testRunCount ?? 0,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.deleteTest(testId, functionName);
    default:
      throw errorMsg;
  }
};

module.exports = { handleScenarioWithTestId };
