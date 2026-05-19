// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const parser = require("./lib/parser/");

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { S3 } = require("@aws-sdk/client-s3");

const utils = require("solution-utils");
let options = utils.getOptions({});
const s3 = new S3(options);

const dynamoDb = DynamoDBDocument.from(new DynamoDB(options));

const parseResults = async (eventConfigs, testId, totalDuration, resultList) => {
  let aggregateData = [];

  const finalResults = {};
  const completeTasks = {};
  const promises = await getFilesByRegion(resultList);
  //Get results per region
  for (const eventConfig of eventConfigs) {
    // Skip processing promises when empty
    if (!promises[eventConfig.region]) continue;

    const data = [];
    const result = await Promise.all(promises[eventConfig.region]);

    //parse each results file
    for (const content of result) {
      const parsedResult = parser.results(await content.Body.transformToString(), testId);
      let duration = parseInt(parsedResult.duration);
      totalDuration += isNaN(duration) ? 0 : duration;
      data.push(parsedResult);

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
        console.error('Failed to send metric:', err);
      }
    }

    //record regional data
    completeTasks[eventConfig.region] = data.length;
    aggregateData = aggregateData.concat(data);

    // Parser final results for region
    let finalResultsPerRegion = await parser.finalResults(testId, data);
    finalResults[eventConfig.region] = finalResultsPerRegion;
  }
  //parse aggregate final results
  if (aggregateData.length > 0) {
    let finalResultsTotal = await parser.finalResults(testId, aggregateData);
    finalResults["total"] = finalResultsTotal;
  }
  return { finalResults, completeTasks };
};

const writeTestDataToHistoryTable = async (
  testId,
  eventConfigs,
  resultList,
  totalDuration,
  testRunId
) => {
  const { finalResults, completeTasks } = await parseResults(
    eventConfigs,
    testId,
    totalDuration,
    resultList
  );

  // Calculate success percentage
  let succPercent = 0;
  // avoid dividing by zero
  if (finalResults["total"] && finalResults["total"].throughput > 0) {
    succPercent = ((finalResults["total"].succ / finalResults["total"].throughput) * 100).toFixed(2);
  }

  // Write test run data to history table
  const historyParams = {
    testId,
    testRunId,
    results: finalResults,
    completeTasks,
    succPercent,
  };
  await parser.updateTestHistoryResults(historyParams);

  //update scenario dynamoDB table
  const updateTableParams = { testId, finalResults, completeTasks };
  await parser.updateTable(updateTableParams);
};
const getScenariosTableItems = async (testId) => {
  const ddbParams = {
    TableName: process.env.SCENARIOS_TABLE,
    Key: {
      testId: testId,
    },
    AttributesToGet: ["startTime", "status", "testTaskConfigs", "testType", "testScenario", "testDescription", "scheduleTimezone"],
  };
  const ddbGetResponse = await dynamoDb.get(ddbParams);
  return ddbGetResponse.Item;
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

exports.handler = async (event) => {
  console.log(`Parsing results: testId=${event.testId}, prefix=${event.prefix}, region=${event.testTaskConfig?.region}, testRunId=${event.testRunId}`);
  const { showLive, testId, testRunId, fileType, prefix, testTaskConfig: eventConfigs, executionStart: testStartTime } = event;

  try {
    const scenariosTableItems = await getScenariosTableItems(testId);
    const { testType } = scenariosTableItems;
    let { status } = scenariosTableItems;
    let totalDuration = 0;
    let testResult = status;

    // ECS tasks attempts to upload result file even during both failure or cancellation
    // so this lambda step will process result files that are available
    let resultList = await getResultList(testId, prefix);
    if (resultList.length > 0) {
      await writeTestDataToHistoryTable(
        testId,
        eventConfigs,
        resultList,
        totalDuration,
        testRunId
      );
      testResult = "completed";
    } else {
      // If there's no result files in S3 bucket, there's a possibility that the test failed in the Fargate tasks.
      testResult = "failed";
    }

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
      TaskCount: eventConfigs.taskCount,
      Concurrency: eventConfigs.concurrency,
      LiveData: showLive,
      Region: eventConfigs.region,
    };
    console.debug(`Sending metrics: ${JSON.stringify(metricsToSend)}`);
    try {
      await utils.sendMetric(metricsToSend);
    } catch (err) {
      console.error('Failed to send metric:', err);
    }
    return "success";
  } catch (error) {
    console.error(`Error in results-parser for testId=${testId}: ${error.message}, Code: ${error.code || 'N/A'}`);
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
        TestType: fileType || "unknown",
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }

    throw new Error(`Failed to parse results: ${error.message || 'Unknown error'}`);
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
