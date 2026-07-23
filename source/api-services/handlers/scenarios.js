// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");
const { getRegions } = require("./regions");

const sendScenarioWriteMetric = async ({ existingEntry, data, config, userAgent }) => {
  try {
    const isUpdate = existingEntry != null;
    const fieldsChanged = isUpdate ? scenarios.computeChangedFields(existingEntry, config) : undefined;
    const concurrencyTotal = (config.testTaskConfigs || []).reduce((sum, t) => sum + (parseInt(t.concurrency) || 0), 0);
    const holdFor = config.testScenario?.execution?.[0]?.["hold-for"];
    const rampUp = config.testScenario?.execution?.[0]?.["ramp-up"];
    const estimatedDuration = scenarios.getTestDurationSeconds(holdFor) + scenarios.getTestDurationSeconds(rampUp);
    const testRunCount = await scenarios.getTestRunCount(data.testId);
    const taskCountPerRegion = {};
    for (const tc of config.testTaskConfigs || []) {
      taskCountPerRegion[tc.region] = tc.taskCount;
    }
    const metric = {
      Type: isUpdate ? "TestUpdate" : "TestCreate",
      TestType: config.testType,
      FileType: config.fileType || (config.testType === "simple" ? "none" : "script"),
      TaskCountPerRegion: taskCountPerRegion,
      TestId: data.testId,
      TestRunNumber: testRunCount,
      HasBaseline: data?.baselineId ? "true" : "false",
      ConcurrencyTotal: concurrencyTotal,
      EstimatedDuration: estimatedDuration,
      TestScheduleStep: config.scheduleStep,
      HoldFor: holdFor,
      RampUp: rampUp,
      CronValue: config.cronValue,
      TestEventBridgeScheduled: config.eventBridge,
      UserAgent: userAgent,
    };
    if (fieldsChanged) {
      metric.FieldsChanged = fieldsChanged;
    }
    await utils.sendMetric(metric);
  } catch (err) {
    console.error("Failed to send metric:", err);
  }
};

const handleScenarios = async (method, resource, errorMsg, config, queryParams, body, functionName, functionArn, userAgent) => {
  let data;
  switch (method) {
    case "GET": {
      if (queryParams && queryParams.op === "listRegions") return getRegions();

      // Handle tag filtering
      const filterTags =
        queryParams && queryParams.tags ? queryParams.tags.split(",").map((tag) => tag.trim()) : null;

      return await scenarios.listTests(filterTags);
    }
    case "POST": {
      // Look up existing entry before dispatching — both createTest and
      // scheduleTest overwrite DDB, so we must read first to detect updates.
      let existingEntry = null;
      try {
        existingEntry = config.testId ? await scenarios.getTestEntry(config.testId) : null;
      } catch (err) {
        console.error("Failed to fetch existing entry for metric:", err);
      }

      if (config.scheduleStep) {
        // Handle scheduling test
        data = await scenarios.scheduleTest(
          {
            resource: resource,
            httpMethod: method,
            body: body,
          },
          {
            functionName: functionName,
            functionArn: functionArn,
          }
        );
      }
      // Handle creating or updating test
      else {
        data = await scenarios.createTest(config, functionName);
      }

      await sendScenarioWriteMetric({ existingEntry, data, config, userAgent });
      return data;
    }
    default:
      throw errorMsg;
  }
};

module.exports = { handleScenarios, sendScenarioWriteMetric };
