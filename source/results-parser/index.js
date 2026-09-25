// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const parser = require("./lib/parser/");
const native = require("./lib/native/");
const { writeFrameworkExitsReport } = require("./lib/framework-exits");

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { S3 } = require("@aws-sdk/client-s3");

const utils = require("solution-utils");
let options = utils.getOptions({});
const s3 = new S3(options);

const dynamoDb = DynamoDBDocument.from(new DynamoDB(options));
const NATIVE_RESULT_BATCH_SIZE = 10;

const parseResults = async (eventConfigs, testId, resultList, nativeRunMode) => {
  if (nativeRunMode != null) return parseNativeRun(eventConfigs, testId, resultList);

  let aggregateData = [];

  const finalResults = {};
  const completeTasks = {};
  const emptyRegions = [];

  const promises = await getFilesByRegion(resultList);

  //Get results per region
  for (const eventConfig of eventConfigs) {
    // Skip processing promises when empty
    if (!promises[eventConfig.region]) continue;

    const parsedResults = await parseLegacyResults(promises[eventConfig.region], testId);

    for (const parsedResult of parsedResults) {
      // Send operational metrics
      try {
        await utils.sendMetric({
          Type: "TaskCompletion",
          TaskVCPU: parsedResult.taskCPU,
          TaskMemory: parsedResult.taskMemory,
          ECSCalculatedDuration: parsedResult.ecsDuration,
          TaskId: parsedResult.taskId,
          TestId: testId,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
    }

    // If a region produces 0 results, we want to fail the load test to bring attention to
    // an underlying issue. However, load tests are not cheap to perform and valid results
    // should be presented to users. We handle empty regions specifically and throw after
    // valid results have been saved.
    if (parsedResults.length === 0) {
      emptyRegions.push(eventConfig.region);
      continue;
    }

    //record regional data
    completeTasks[eventConfig.region] = parsedResults.length;
    aggregateData = aggregateData.concat(parsedResults);

    // Parser final results for region
    let finalResultsPerRegion = await parser.finalResults(testId, parsedResults);
    finalResults[eventConfig.region] = finalResultsPerRegion;
  }
  //parse aggregate final results
  if (aggregateData.length > 0) {
    let finalResultsTotal = await parser.finalResults(testId, aggregateData);
    finalResults["total"] = finalResultsTotal;
  }
  return { finalResults, completeTasks, emptyRegions };
};

const writeTestDataToHistoryTable = async (
  testId,
  eventConfigs,
  resultList,
  testRunId,
  nativeRunMode,
  executionFailed
) => {
  const {
    finalResults,
    completeTasks,
    emptyRegions,
    issueCount = 0,
  } = await parseResults(eventConfigs, testId, resultList, nativeRunMode);

  // Calculate success percentage
  let succPercent = 0;
  // avoid dividing by zero
  if (finalResults["total"] && finalResults["total"].throughput > 0) {
    succPercent = ((finalResults["total"].succ / finalResults["total"].throughput) * 100).toFixed(2);
  }

  // Legacy runs preserve their existing empty-result writes. Native runs only write usable data.
  if (nativeRunMode == null || Object.keys(finalResults).length > 0) {
    const historyParams = {
      testId,
      testRunId,
      results: finalResults,
      completeTasks,
      succPercent,
    };
    await parser.updateTestHistoryResults(historyParams);

    const updateTableParams = { testId, finalResults, completeTasks };
    await parser.updateTable(updateTableParams);
  }

  // Step Functions already preserves the more useful execution failure and its operational metric.
  if (nativeRunMode != null && executionFailed) return;

  // Throw on empty regions to surface underlying issues. We wait until valid results have been
  // parsed and saved to the history table to ensure customers don't lose results that they have
  // already spent time and money to collect.
  if (emptyRegions.length > 0) {
    throw new Error(
      `No requests were recorded in ${emptyRegions.join(", ")} - check the test configuration and target`
    );
  }
  if (nativeRunMode != null && issueCount > 0) {
    throw new Error("Native result collection was incomplete; see CloudWatch logs for details");
  }
};

const getResultList = async (testId, s3Prefix) => {
  const bucket = process.env.SCENARIOS_BUCKET;
  let resultList = [];
  let nextContinuationToken = undefined;

  // Get the latest test result from S3
  do {
    const params = {
      Bucket: bucket,
      Prefix: `results/${testId}/${s3Prefix}`,
    };

    if (nextContinuationToken) {
      params.ContinuationToken = nextContinuationToken;
    }
    const result = await s3.listObjectsV2(params);
    resultList = resultList.concat(result.Contents ?? []);
    nextContinuationToken = result.IsTruncated ? result.NextContinuationToken : null;
  } while (nextContinuationToken);
  // exclude objects in /results relating to completion signals
  return resultList.filter((item) => !item.Key.includes("/completion/"));
};

// // Define a function to create the timeout promise
const createTimeoutPromise = (timeout) =>
  new Promise((resolve) =>
    setTimeout(() => {
      resolve(true); // Resolve with a true value to indicate a timeout
    }, timeout)
  );

const getFilesByRegion = async (resultList) => {
  const promises = {};

  //get all results files from test sorted by region
  for (const content of resultList) {
    //extract region from file name
    const regex = /[a-z]{1,3}-(?:gov-[a-z]+|[a-z]+)-\d(?=\.xml)/g;

    // Check if logString exceeds character limit
    if (content.Key.length > 250) throw new Error("Log message exceeds character limit.");
    const timeoutPromise = createTimeoutPromise(5000);

    // Wrap the regular expression match in a promise
    const regexPromise = new Promise((resolve) => {
      const matchedRegions = content.Key.match(regex);
      if (matchedRegions) {
        const fileRegion = matchedRegions.pop();
        resolve(fileRegion);
      } else {
        resolve(null);
      }
    });

    const raceResult = await Promise.race([timeoutPromise, regexPromise]);
    if (raceResult === true) throw new Error("Regex match timed out.");
    if (!raceResult) continue;

    const region = raceResult;
    !(region in promises) && (promises[region] = []);
    promises[region].push(
      s3.getObject({
        Bucket: process.env.SCENARIOS_BUCKET,
        Key: content.Key,
      })
    );
  }
  return promises;
};

/**
 * Reads and parses the Taurus XML results for one region.
 * @param {Promise[]} promises GetObject promises for a single region
 * @param {string} testId Test ID
 * @return {Promise<object[]>} Per-task results
 */
const parseLegacyResults = async (promises, testId) => {
  const results = [];
  for (const content of await Promise.all(promises)) {
    results.push(parser.results(await content.Body.transformToString(), testId));
  }
  return results;
};

const recordNativeIssue = (issues, details, error) => {
  issues.count += 1;
  console.error("Native result issue:", {
    ...details,
    error: error instanceof Error ? error.message : String(error),
  });
};

const getNativeResultRegion = (key, testId) => {
  const segments = key.split("/");
  if (
    segments.length !== 6 ||
    segments[0] !== "results" ||
    segments[1] !== testId ||
    segments[2] === "" ||
    segments[3] === "" ||
    segments[4] === ""
  ) {
    return null;
  }
  return segments[3];
};

/**
 * Sorts a native run's valid, configured result keys by region without starting any S3 reads.
 * @param {object[]} resultList S3 listing entries for the run
 * @param {string} testId Expected test identifier
 * @param {object[]} eventConfigs Per-region task configuration
 * @param {{count: number}} issues Recoverable issue counter
 * @return {Map<string, string[]>} Region to sorted result keys
 */
const getNativeFilesByRegion = (resultList, testId, eventConfigs, issues) => {
  const keysByRegion = new Map();
  const configuredRegions = new Set(eventConfigs.map(({ region }) => region));

  for (const content of resultList) {
    // A task uploads everything in its artifacts directory, so the listing also has files
    // the framework wrote for its own purposes — locust-final.json and friends. result.json
    // is the one we asked for.
    const key = content.Key;
    if (typeof key !== "string" || !key.endsWith("/result.json")) continue;

    const region = getNativeResultRegion(key, testId);
    if (region == null) {
      recordNativeIssue(issues, { key }, `Invalid native result key: ${key}`);
      continue;
    }

    if (!configuredRegions.has(region)) {
      recordNativeIssue(issues, { key, region }, `Unexpected native result region: ${region}`);
      continue;
    }

    const keys = keysByRegion.get(region) ?? [];
    keys.push(key);
    keysByRegion.set(region, keys);
  }
  for (const keys of keysByRegion.values()) keys.sort();
  return keysByRegion;
};

const readNativeTask = async (key, testId, region) => {
  const content = await s3.getObject({
    Bucket: process.env.SCENARIOS_BUCKET,
    Key: key,
  });
  if (typeof content.Body?.transformToString !== "function") {
    throw new TypeError(`Result artifact ${key} has no readable body.`);
  }

  return native.validateArtifact(JSON.parse(await content.Body.transformToString()), {
    testId,
    region,
    taskId: key.split("/")[4],
  });
};

const mergeNativeTaskResults = (regional, batchKeys, taskResults, region, issues) => {
  const tasksForMetrics = [];
  let validArtifactCount = 0;

  for (const [index, result] of taskResults.entries()) {
    const key = batchKeys[index];
    if (result.status === "rejected") {
      recordNativeIssue(issues, { key, region }, result.reason);
      continue;
    }

    const task = result.value;
    try {
      const requestCount = native.addTask(regional, task);
      validArtifactCount += 1;

      if (requestCount === 0)
        console.warn(`Skipping result for task ${task.taskId} in ${region}: no requests recorded`);
      else tasksForMetrics.push(task);
    } catch (error) {
      recordNativeIssue(issues, { key, region }, error);
    }
  }

  return { tasksForMetrics, validArtifactCount };
};

const parseNativeRegion = async ({ region, taskCount }, keys, testId, issues) => {
  const regional = native.createAggregate();
  let validArtifactCount = 0;

  for (let offset = 0; offset < keys.length; offset += NATIVE_RESULT_BATCH_SIZE) {
    const batchKeys = keys.slice(offset, offset + NATIVE_RESULT_BATCH_SIZE);
    const taskResults = await Promise.allSettled(batchKeys.map((key) => readNativeTask(key, testId, region)));
    const mergedBatch = mergeNativeTaskResults(regional, batchKeys, taskResults, region, issues);
    validArtifactCount += mergedBatch.validArtifactCount;

    const metricResults = await Promise.allSettled(
      mergedBatch.tasksForMetrics.map((task) =>
        utils.sendMetric({
          Type: "TaskCompletion",
          TaskVCPU: task.taskCPU,
          TaskMemory: task.taskMemory,
          ECSCalculatedDuration: task.ecsDuration,
          TaskId: task.taskId,
          TestId: testId,
        })
      )
    );
    for (const result of metricResults) {
      if (result.status === "rejected") console.error("Failed to send metric:", result.reason);
    }
  }

  if (validArtifactCount !== taskCount) {
    recordNativeIssue(
      issues,
      { region, expectedTaskCount: taskCount, validArtifactCount },
      `Expected ${taskCount} valid result artifact(s), found ${validArtifactCount}`
    );
  }

  return { regional, validArtifactCount };
};

/**
 * Reads native artifacts in bounded batches, then validates and merges them in key order.
 * @param {object[]} eventConfigs Per-region task configuration
 * @param {string} testId Test identifier
 * @param {object[]} resultList S3 listing entries
 * @return {Promise<object>} Regional and total API results
 */
const parseNativeRun = async (eventConfigs, testId, resultList) => {
  const finalResults = {};
  const completeTasks = {};
  const emptyRegions = [];
  const issues = { count: 0 };
  const keysByRegion = getNativeFilesByRegion(resultList, testId, eventConfigs, issues);
  const total = native.createAggregate();

  for (const eventConfig of eventConfigs) {
    const region = eventConfig.region;
    const { regional, validArtifactCount } = await parseNativeRegion(
      eventConfig,
      keysByRegion.get(region) ?? [],
      testId,
      issues
    );

    if (regional.taskCount === 0) {
      if (validArtifactCount === eventConfig.taskCount) emptyRegions.push(region);
      continue;
    }

    completeTasks[region] = regional.taskCount;
    native.addAggregate(total, regional);
    finalResults[region] = await parser.finalResults(testId, [native.toMergedTaskResult(regional)]);
  }

  if (total.taskCount > 0) {
    finalResults.total = await parser.finalResults(testId, [native.toMergedTaskResult(total)]);
  }

  return { finalResults, completeTasks, emptyRegions, issueCount: issues.count };
};

const writeResultsAndFrameworkExitReport = async ({
  testId,
  testRunId,
  prefix,
  eventConfigs,
  framework,
  resultList,
  nativeRunMode,
  executionFailed,
}) => {
  // Save framework-exit evidence before normal result validation. A framework
  // may exit before producing result.json, but its diagnostic report is still useful.
  let frameworkExitReport;
  if (nativeRunMode != null) {
    frameworkExitReport = await writeFrameworkExitsReport({
      s3,
      bucket: process.env.SCENARIOS_BUCKET,
      resultList,
      testId,
      prefix,
    }).catch((error) => {
      console.error("Framework-exit reporting failed:", {
        testId,
        testRunId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    const statistics = frameworkExitReport?.statistics;
    if (statistics) {
      await utils.sendMetric({
        Type: "NativeFrameworkRunSummary",
        TestId: testId,
        TestRunId: testRunId,
        Framework: framework,
        FrameworkExitTaskCount: statistics.frameworkExitTaskCount,
        ExitCodeCounts: statistics.exitCodeCounts,
        InvalidExitArtifactCount: statistics.invalidExitArtifactCount,
      });
    }
  }

  // Hold the existing result error long enough to attempt the optional summary.
  // The error is rethrown below, so result validation still decides test status.
  let resultError;
  try {
    if (resultList.length > 0 || nativeRunMode != null) {
      await writeTestDataToHistoryTable(testId, eventConfigs, resultList, testRunId, nativeRunMode, executionFailed);
    }
  } catch (error) {
    resultError = error;
  }

  // Write the small summary separately from normal results. A DynamoDB size or
  // condition failure here must not undo valid result updates or fail the test.
  if (frameworkExitReport?.summary) {
    await parser
      .updateFrameworkExitSummary({
        testId,
        testRunId,
        summary: frameworkExitReport.summary,
      })
      .catch((error) => {
        console.error("Framework-exit summary update failed:", {
          testId,
          testRunId,
          artifactKey: frameworkExitReport.artifactKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  // Preserve the result parser's existing failure behavior after reporting is done.
  if (resultError) throw resultError;
};

exports.handler = async (event) => {
  console.log(
    `Parsing results: testId=${event.testId}, prefix=${event.prefix}, region=${event.testTaskConfig?.region}, testRunId=${event.testRunId}`
  );
  const {
    showLive,
    testId,
    testRunId,
    fileType,
    prefix,
    testTaskConfig: eventConfigs,
    executionStart: testStartTime,
    nativeRunMode,
    executionFailed,
    testType,
  } = event;

  try {
    // ECS tasks attempts to upload result file even during both failure or cancellation
    // so this lambda step will process result files that are available
    const resultList = await getResultList(testId, prefix);
    await writeResultsAndFrameworkExitReport({
      testId,
      testRunId,
      prefix,
      eventConfigs,
      framework: testType,
      resultList,
      nativeRunMode,
      executionFailed,
    });

    // A failed test may still upload partial results, so uploaded files alone do not mean it completed successfully.
    const completedSuccessfully = !executionFailed && resultList.length > 0;
    const testResult = completedSuccessfully ? "completed" : "failed";

    // Send operational metrics
    const currentTime = new Date();
    const durationMilliseconds = currentTime - new Date(testStartTime);
    const durationSeconds = durationMilliseconds / 1000;
    const metricsToSend = {
      Type: "TestCompletion",
      TestType: testType,
      FileType: fileType || (testType === "simple" ? "none" : "script"),
      TestResult: testResult,
      Duration: durationSeconds,
      TestId: testId,
      TestRunId: testRunId,
      RunMode: nativeRunMode == null ? "standard" : "native",
      TaskCount: eventConfigs.taskCount,
      Concurrency: eventConfigs.concurrency,
      LiveData: showLive,
      Region: eventConfigs.region,
    };
    console.debug(`Sending metrics: ${JSON.stringify(metricsToSend)}`);
    try {
      await utils.sendMetric(metricsToSend);
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return "success";
  } catch (error) {
    console.error(`Error in results-parser for testId=${testId}: ${error.message}, Code: ${error.code || "N/A"}`);
    if (error.message.includes("Item size has exceeded the maximum allowed size"))
      await updateScenariosTable(
        testId,
        "Failed to parse the results - One item uploading to DynamoDB has exceeded the maximum allowed size (400KB)"
      );
    else await updateScenariosTable(testId, `Failed to parse the results - ${error.message}`);

    try {
      await utils.sendMetric({
        Type: "ResultsParsingFailed",
        TestId: testId,
        TestRunId: testRunId,
        TestType: fileType || "unknown",
        Framework: testType,
        RunMode: nativeRunMode == null ? "standard" : "native",
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }

    throw new Error(`Failed to parse results: ${error.message || "Unknown error"}`);
  }
};

const updateScenariosTable = async (testId, errorReason) => {
  await dynamoDb.update({
    TableName: process.env.SCENARIOS_TABLE,
    Key: { testId },
    UpdateExpression: "set #s = :s, #e = :e",
    ExpressionAttributeNames: {
      "#s": "status",
      "#e": "errorReason",
    },
    ExpressionAttributeValues: {
      ":s": "failed",
      ":e": errorReason,
    },
  });
};

if (process.env.RUNNING_UNIT_TESTS === "True") {
  exports._getFilesByRegion = getFilesByRegion;
}
