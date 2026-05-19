// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { S3 } = require("@aws-sdk/client-s3");

const parser = require("xml-js");
const utils = require("solution-utils");
const { AWS_REGION, HISTORY_TABLE, SCENARIOS_TABLE } = process.env;
const awsOptions = utils.getOptions({ region: AWS_REGION });
const dynamoDb = DynamoDBDocument.from(new DynamoDB(awsOptions));
const s3 = new S3(awsOptions);

/**
 * Breaking down results item and creating the basic breakdown object.
 * @param {group} each result item in xml file
 * @return {stats} stats is the object name created to represented the stats of each result item
 */
function breakdownGroupResults(group) {
  let stats = {
    rc: [],
  };

  // loop through group results
  for (let r in group) {
    if (r !== "_attributes" && r !== "perc" && r !== "rc") {
      stats[r] = group[r].value._text;
    }
  }

  return stats;
}

/**
 * Updates the response code for each result item. If the response code is not in the accepted list, it will be added to the response code list.
 * @param {stats} stats object
 * @param {responseCodes} responseCodes associated with each result item
 */
function updateResultsResponseCode(stats, responseCodes) {
  // loop through response codes, rc is a object for single responses array for multiple
  const acceptedCodes = ["200", "201", "202", "204", "300", "301", "302", "303", "304", "307", "308", "101", "1000"];
  if (Array.isArray(responseCodes)) {
    for (let responseCode of responseCodes) {
      if (!acceptedCodes.includes(responseCode._attributes.param)) {
        stats.rc.push({ code: responseCode._attributes.param, count: parseInt(responseCode._attributes.value) });
      }
    }
  } else {
    if (!acceptedCodes.includes(responseCodes._attributes.param)) {
      stats.rc.push({ code: responseCodes._attributes.param, count: parseInt(responseCodes._attributes.value) });
    }
  }
}

/**
 * Updates the percentiles for each result item.
 * @param {stats} stats object
 * @param {groupPrecentiles} success, failure and other stats percentiles associated with each result item
 */
function updatePercentiles(stats, groupPrecentiles) {
  for (let percentiles of groupPrecentiles) {
    const perc = "p" + percentiles._attributes.param.replace(".", "_");
    stats[perc] = percentiles.value._text;
  }
}

/**
 * Parses test result XML from S3 to JSON, and return the result summary.
 * @param {object} content S3 object body - XML
 * @param {string} testId Test ID
 * @return {Promise<{ stats: object, labels: object[], duration: string }>} Test result from one task
 */
function results(content, testId) {
  console.log(`Processing results, testId: ${testId}`);

  try {
    const options = {
      nativeType: true,
      compact: true,
      ignoreAttributes: false,
    };
    const json = parser.xml2js(content, options);
    const jsonData = json.FinalStatus;
    let labels = [];
    let result = {};

    console.log(`Converted XML to JSON for testId: ${testId}`);

    // loop through results
    for (let resultsItem of jsonData.Group) {
      const group = resultsItem;
      const label = group._attributes.label;
      let stats = breakdownGroupResults(group);
      updateResultsResponseCode(stats, group.rc);
      updatePercentiles(stats, group.perc);
      // check if the results are for the group (label '') or for a specific label
      // label '' is the average results for all the labels.
      if (label) {
        stats.label = label;
        labels.push(stats);
      } else {
        result = stats;
      }
    }
    result.testDuration = jsonData.TestDuration._text;

    return {
      stats: result,
      labels,
      duration: jsonData.TestDuration._text,
      taskId: jsonData.TaskId._text,
      taskCPU: jsonData.TaskCPU._text,
      taskMemory: jsonData.TaskMemory._text,
      ecsDuration: jsonData.ECSDuration._text,
    };
  } catch (error) {
    console.error("results function error", error);
    throw error;
  }
}

/**
 * Returns the average value of an array.
 * @param {number[]} array Number array to get the average value
 * @return {number} Average number of the numbers in the array
 */
const getAvg = (array) => {
  if (array.length === 0) return 0;
  return array.reduce((a, b) => a + b, 0) / array.length;
};

/**
 * Returns the summarized response codes and sum count.
 * @param {object[]} array Response code object array which includes { code: string, count: number|string } objects
 * @return {object[]} Summarized response codes and sum count
 */
const getReducedResponseCodes = (array) =>
  array.reduce((accumulator, currentValue) => {
    const count = parseInt(currentValue.count);
    currentValue.count = isNaN(count) ? 0 : count;

    const existing = accumulator.find((acc) => acc.code === currentValue.code);
    if (existing) {
      existing.count += currentValue.count;
    } else {
      accumulator.push(currentValue);
    }
    return accumulator;
  }, []);

/**
 * Aggregates the all results from Taurus to one result object.
 * @param {object} stats Stats object which includes all the results from Taurus
 * @param {object} result Result object which aggregates the same key values into
 */
const createAggregatedData = (stats, result) => {
  for (let key in stats) {
    if (key === "label") {
      result.label = stats[key];
    } else if (key === "rc") {
      result.rc = result.rc.concat(stats.rc);
    } else {
      result[key].push(stats[key]);
    }
  }
};
/**
 * Created the final results
 * @param {object} source Aggregated Taurus results
 * @param {object} result Summarized final results
 */
const createFinalResults = (source, result) => {
  for (let key in source) {
    switch (key) {
      case "label":
      case "labels":
      case "rc":
        result[key] = source[key];
        break;
      case "fail":
      case "succ":
      case "throughput":
        result[key] = source[key].reduce((a, b) => a + b);
        break;
      case "bytes":
      case "concurrency":
      case "testDuration":
        result[key] = getAvg(source[key]).toFixed(0);
        break;
      case "avg_ct":
      case "avg_lt":
      case "avg_rt":
        result[key] = getAvg(source[key]).toFixed(5);
        break;
      default:
        result[key] = getAvg(source[key]).toFixed(3);
    }
  }
};

function createAllLables(keys, all, stats) {
  let labels = [];
  for (let label of keys) {
    let labelTestFinalResults = {};
    let labelAll = {
      avg_ct: [],
      avg_lt: [],
      avg_rt: [],
      bytes: [],
      concurrency: [],
      fail: [],
      label: "",
      p0_0: [],
      p100_0: [],
      p50_0: [],
      p90_0: [],
      p95_0: [],
      p99_0: [],
      p99_9: [],
      stdev_rt: [],
      succ: [],
      testDuration: [],
      throughput: [],
      rc: [],
    };

    const labelStats = all.labels.filter((stats) => stats.label === label);
    for (let stat of labelStats) {
      createAggregatedData(stat, labelAll);
    }

    // find duplicates in response codes and sum count
    if (labelAll.rc.length > 0) {
      labelAll.rc = getReducedResponseCodes(labelAll.rc);
    }

    // parse all of the results to generate the final results.
    createFinalResults(labelAll, labelTestFinalResults);
    labels.push(labelTestFinalResults);
  }
  return labels;
}

/**
 * Integrates the all test results and updates DynamoDB record
 * @param {object} finalResultParams object containing test configuration and test result details
 */
async function finalResults(testId, data) {
  console.log(`Parsing Final Results for ${testId}`);

  let testFinalResults = {};
  let all = {
    avg_ct: [],
    avg_lt: [],
    avg_rt: [],
    bytes: [],
    concurrency: [],
    fail: [],
    p0_0: [],
    p100_0: [],
    p50_0: [],
    p90_0: [],
    p95_0: [],
    p99_0: [],
    p99_9: [],
    stdev_rt: [],
    succ: [],
    testDuration: [],
    throughput: [],
    rc: [],
    labels: [],
  };
  let stats;

  // Creating the deep copy to avoid duplicating values when calculating error counts for each rc
  const dataDeepCopy = JSON.parse(JSON.stringify(data));
  for (let result of dataDeepCopy) {
    let { labels, stats } = result;
    createAggregatedData(stats, all);

    // Sub results if any
    if (labels.length > 0) {
      all.labels = all.labels.concat(labels);
    }
  }

  // find duplicates in response codes and sum count
  if (all.rc.length > 0) {
    all.rc = getReducedResponseCodes(all.rc);
  }

  // summarize the test result per label
  if (all.labels.length > 0) {
    let set = new Set();

    for (let label of all.labels) {
      set.add(label.label);
    }

    all.labels = createAllLables(set.keys(), all, stats);
  }

  // parse all of the results to generate the final results.
  createFinalResults(all, testFinalResults);
  console.log(`Final results calculated for testId: ${testId}, success=${testFinalResults.succ || 0}, failures=${testFinalResults.fail || 0}`);
  return testFinalResults;
}

/**
 * Updates the test history table with final test results, completed task count, and success percentage.
 * @param {string} testId The unique identifier for the test scenario.
 * @param {string} testRunId The unique identifier for this specific test run.
 * @param {object} results The aggregated final test results object.
 * @param {object} completeTasks The number of ECS tasks that completed successfully.
 * @param {string} succPercent The percentage of successful requests (undefined when throughput is zero).
 */
async function updateTestHistoryResults({ testId, testRunId, results, completeTasks, succPercent }) {
  try {
    // Validate results data exists before updating table
    if (Object.keys(results).length === 0 || Object.keys(completeTasks).length === 0 || !succPercent) {
      return;
    }

    const ddbParams = {
      TableName: HISTORY_TABLE,
      Key: { testId, testRunId },
      UpdateExpression: "set #r = :r, #ct = :ct, #sp = :sp",
      ExpressionAttributeNames: {
        "#r": "results",
        "#ct": "completeTasks",
        "#sp": "succPercent",
      },
      ExpressionAttributeValues: {
        ":r": results,
        ":ct": completeTasks,
        ":sp": succPercent,
      },
    };
    await dynamoDb.update(ddbParams);
  } catch (err) {
    console.error(`Error occured updating test history table after parsing results for testId=${testId}, testRunId=${testRunId}`);
    console.error(err);
    throw err;
  }
}

// Updating scenarios table with test results
async function updateTable(params) {
  const { testId, finalResults: finalTestResults, completeTasks } = params;

  const ddbUpdateParams = {
    TableName: SCENARIOS_TABLE,
    Key: {
      testId: testId,
    },
    UpdateExpression: "set #r = :r, #ct = :ct",
    ExpressionAttributeNames: {
      "#r": "results",
      "#ct": "completeTasks",
    },
    ExpressionAttributeValues: {
      ":r": finalTestResults,
      ":ct": completeTasks,
    },
    ReturnValues: "ALL_NEW",
  };
  await dynamoDb.update(ddbUpdateParams);
  return "Success";
}

module.exports = {
  results,
  finalResults,
  updateTestHistoryResults,
  updateTable,
};
