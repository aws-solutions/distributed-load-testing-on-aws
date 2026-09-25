// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("../lib/scenarios/");
const utils = require("solution-utils");
const { getRegions } = require("./regions");

const sendScenarioWriteMetric = async ({ existingEntry, data, config, userAgent }) => {
  try {
    const isUpdate = existingEntry != null;
    const fieldsChanged = isUpdate ? scenarios.computeChangedFields(existingEntry, config) : undefined;
    const concurrencyTotal = (config.testTaskConfigs || []).reduce((sum, t) => sum + (Number.parseInt(t.concurrency) || 0), 0);
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
      RunMode: config.nativeRunMode == null ? "standard" : "native",
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

/**
 * Emits a product-telemetry event when a start request is rejected because the
 * scenario already has an active run (server-side single-run enforcement).
 *
 * Uses the same instrumentation envelope as every other metric (AWS account id,
 * solution id, version, UUID are attached by utils.sendMetric), so rejections
 * are observable alongside TestCreate/TestUpdate. Failures to emit never affect
 * the API response — the caller still receives the 409.
 *
 * @param {object}  params
 * @param {object}  params.config        The incoming request config.
 * @param {string}  params.userAgent     Caller user agent (console, cli, mcp, curl).
 * @param {object=} params.existingEntry The active scenario record, if known.
 */
const sendScenarioRejectionMetric = async ({ config, userAgent, existingEntry }) => {
  try {
    const taskCountPerRegion = {};
    for (const tc of config.testTaskConfigs || []) {
      taskCountPerRegion[tc.region] = tc.taskCount;
    }
    const metric = {
      Type: "TestStartRejected",
      Reason: "already_running",
      TestId: config.testId,
      Status: existingEntry?.status,
      TestType: config.testType,
      TaskCountPerRegion: taskCountPerRegion,
      UserAgent: userAgent,
    };
    await utils.sendMetric(metric);
  } catch (err) {
    console.error("Failed to send rejection metric:", err);
  }
};

// Reads the existing scenario record before a write. Both createTest and
// scheduleTest overwrite DDB, so it must be read first to detect updates for
// metrics. A read failure is non-fatal (it only affects metric accuracy).
const fetchExistingEntry = async (testId) => {
  if (!testId) return null;
  try {
    return await scenarios.getTestEntry(testId);
  } catch (err) {
    console.error("Failed to fetch existing entry for metric:", err);
    return null;
  }
};

const handleGetScenarios = (queryParams) => {
  if (queryParams?.op === "listRegions") return getRegions();
  const filterTags = queryParams?.tags ? queryParams.tags.split(",").map((tag) => tag.trim()) : null;
  return scenarios.listTests(filterTags);
};

// Dispatches to scheduleTest or createTest. On a single-run guard rejection
// (TEST_RUNNING from a non-saveOnly start), emits a product-telemetry event
// before the 409 propagates. saveOnly edits hit the same code but are not
// "start" attempts, so they are excluded.
const dispatchScenarioWrite = async ({ method, resource, body, config, functionName, functionArn, userAgent, existingEntry }) => {
  if (config.scheduleStep) {
    return scenarios.scheduleTest({ resource, httpMethod: method, body }, { functionName, functionArn });
  }
  try {
    return await scenarios.createTest(config, functionName);
  } catch (err) {
    if (err?.code === "TEST_RUNNING" && !config.saveOnly) {
      await sendScenarioRejectionMetric({ config, userAgent, existingEntry });
    }
    throw err;
  }
};

const handlePostScenarios = async ({ method, resource, body, config, functionName, functionArn, userAgent }) => {
  const existingEntry = await fetchExistingEntry(config.testId);
  const data = await dispatchScenarioWrite({
    method,
    resource,
    body,
    config,
    functionName,
    functionArn,
    userAgent,
    existingEntry,
  });
  await sendScenarioWriteMetric({ existingEntry, data, config, userAgent });
  return data;
};

const handleScenarios = async (method, resource, errorMsg, config, queryParams, body, functionName, functionArn, userAgent) => {
  switch (method) {
    case "GET":
      return handleGetScenarios(queryParams);
    case "POST":
      return handlePostScenarios({ method, resource, body, config, functionName, functionArn, userAgent });
    default:
      throw errorMsg;
  }
};

module.exports = { handleScenarios, sendScenarioWriteMetric, sendScenarioRejectionMetric };
