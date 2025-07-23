// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { CloudWatch } = require("@aws-sdk/client-cloudwatch");
const { CloudWatchLogs } = require("@aws-sdk/client-cloudwatch-logs");
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

    console.log(`xml to json: ${JSON.stringify(jsonData, null, 2)}`);

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
  console.log("Final Results: ", JSON.stringify(testFinalResults, null, 2));
  return testFinalResults;
}

// Updating history Table with test results
async function putTestHistory(historyParams) {
  try {
    const {
      status,
      testId,
      finalResults: finalTestResults,
      startTime,
      endTime,
      testTaskConfigs,
      testScenario,
      testDescription,
      testType,
      completeTasks,
    } = historyParams;
    const thisTestScenario = JSON.parse(testScenario);
    const succPercent = ((finalTestResults["total"].succ / finalTestResults["total"].throughput) * 100).toFixed(2);
    const history = {
      testRunId: utils.generateUniqueId(10),
      startTime,
      endTime,
      results: finalTestResults,
      status,
      succPercent,
      testId,
      testTaskConfigs,
      testScenario: thisTestScenario,
      testDescription,
      testType,
      completeTasks,
    };
    const ddbParams = {
      TableName: HISTORY_TABLE,
      Item: history,
    };
    await dynamoDb.put(ddbParams);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

// Updating scenarios table with test results
async function updateTable(params) {
  const { status, testId, finalResults: finalTestResults, endTime, completeTasks } = params;

  const ddbUpdateParams = {
    TableName: SCENARIOS_TABLE,
    Key: {
      testId: testId,
    },
    UpdateExpression: "set #r = :r, #t = :t, #s = :s, #ct = :ct",
    ExpressionAttributeNames: {
      "#r": "results",
      "#t": "endTime",
      "#s": "status",
      "#ct": "completeTasks",
    },
    ExpressionAttributeValues: {
      ":r": finalTestResults,
      ":t": endTime,
      ":s": status,
      ":ct": completeTasks,
    },
    ReturnValues: "ALL_NEW",
  };
  await dynamoDb.update(ddbUpdateParams);
  return "Success";
}

function getWidgetMetrics(testId, options) {
  const metrics = [];
  const metricOptions = {
    avgRt: {
      label: "Avg Response Time",
      color: "#FF9900",
    },
    numVu: {
      label: "Accumulated Virtual Users Activities",
      color: "#1f77b4",
    },
    numSucc: {
      label: "Successes",
      color: "#2CA02C",
    },
    numFail: {
      label: "Failures",
      color: "#D62728",
    },
  };

  for (const key in metricOptions) {
    let metric = [];
    let addedOptions = {};
    //add either stat or expression
    if (options.expression) {
      addedOptions.expression =
        key === "avgRt" ? `AVG([${options.expression[key]}])` : `SUM([${options.expression[key]}])`;
    } else {
      addedOptions = options;
      metric = ["distributed-load-testing", `${testId}-${key}`];
      key !== "avgRt" && (metricOptions[key].stat = "Sum");
    }
    //if key is not avgRt add sum and yAxis options
    key !== "avgRt" && (metricOptions[key].yAxis = "right");

    //add in provided options
    metricOptions[key] = { ...metricOptions[key], ...addedOptions };

    metric.push(metricOptions[key]);
    metrics.push(metric);
  }

  return metrics;
}

async function createWidget(startTime, endTime, region, testId, metrics) {
  if (region !== "total") {
    metrics = getWidgetMetrics(testId, { region: region });
  } else {
    const metricIds = { avgRt: [], numVu: [], numSucc: [], numFail: [] };
    metrics = metrics.map((metric) => {
      const metricName = metric[1].split("-").pop();
      const metricId = `${metricName}${metricIds[metricName].length}`;
      metricIds[metricName].push(metricId);
      metric[2] = { ...metric[2], visible: false, id: metricId };
      return metric;
    });
    metrics = metrics.concat(getWidgetMetrics(testId, { expression: metricIds }));
  }

  const widget = {
    title: `CloudWatchMetrics-${region}`,
    width: 600,
    height: 395,
    metrics: metrics,
    period: 10,
    yAxis: {
      left: {
        showUnits: false,
        label: "Seconds",
      },
      right: {
        showUnits: false,
        label: "Total",
      },
    },
    stat: "Average",
    view: "timeSeries",
    start: new Date(startTime).toISOString(),
    end: new Date(endTime).toISOString(),
  };
  const cwParams = {
    MetricWidget: JSON.stringify(widget),
  };
  console.log(JSON.stringify(widget));
  // Write the image to S3, store the object key in DDB
  awsOptions.region = region === "total" ? AWS_REGION : region;
  const cloudwatch = new CloudWatch(awsOptions);
  const image = await cloudwatch.getMetricWidgetImage(cwParams);
  const metricWidgetImage = Buffer.from(image.MetricWidgetImage).toString("base64");
  const metricImageTitle = `${widget.title}-${widget.start}`;
  const metricS3ObjectKey = `cloudwatch-images/${testId}/${metricImageTitle}`;
  const s3PutObjectParams = {
    Body: metricWidgetImage,
    Bucket: process.env.SCENARIOS_BUCKET,
    Key: `public/${metricS3ObjectKey}`,
    ContentEncoding: "base64",
    ContentType: "image/jpeg",
  };
  await s3.putObject(s3PutObjectParams);
  console.log(`Wrote metric widget public/${metricS3ObjectKey} to S3 bucket`);

  return { metricS3Location: metricS3ObjectKey, metrics: widget.metrics };
}

async function deleteRegionalMetricFilter(testId, region, taskCluster, ecsCloudWatchLogGroup) {
  awsOptions.region = region;
  const cloudwatchLogs = new CloudWatchLogs(awsOptions);
  const metrics = ["numVu", "numSucc", "numFail", "avgRt"];
  for (const metric of metrics) {
    const deleteMetricFilterParams = {
      filterName: `${taskCluster}-Ecs${metric}-${testId}`,
      logGroupName: ecsCloudWatchLogGroup,
    };
    await cloudwatchLogs.deleteMetricFilter(deleteMetricFilterParams);
  }
  return "Success";
}

module.exports = {
  results,
  finalResults,
  createWidget,
  deleteRegionalMetricFilter,
  putTestHistory,
  updateTable,
};
