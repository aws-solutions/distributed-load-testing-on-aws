// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { Scheduler } = require("@aws-sdk/client-scheduler");

const utils = require("solution-utils");

const { MAIN_REGION, DDB_TABLE, HISTORY_TABLE } = process.env;
let options = utils.getOptions({ region: MAIN_REGION });
options = utils.getOptions(options);
const dynamoDB = DynamoDBDocument.from(new DynamoDB(options));
const scheduler = new Scheduler(options);

/**
 * Scans the scenarios DynamoDB table for configured tests.
 * Returns only testId and testName fields.
 * Paginates automatically to retrieve all items.
 */
const getAllTestScenarios = async () => {
  const params = {
    TableName: DDB_TABLE,
    FilterExpression: "attribute_exists(testName)",
    ProjectionExpression: "testId, testName",
  };

  const items = [];
  do {
    const result = await dynamoDB.scan(params);
    items.push(...result.Items);
    params.ExclusiveStartKey = result.LastEvaluatedKey;
  } while (params.ExclusiveStartKey);

  console.log(`Fetched ${items.length} tests from DynamoDB`);
  return items;
};

/**
 * Delete all schedules for a test.
 * @param {string} testId
 */
const tryDeleteSchedule = async (testId) => {
  const scheduleNames = [`${testId}Create`, `${testId}Scheduled`];
  for (const name of scheduleNames) {
    try {
      await scheduler.deleteSchedule({ Name: name });
      console.log(`Deleted schedule "${name}"`);
    } catch (err) {
      if (err.name !== "ResourceNotFoundException") {
        console.error(err);
      }
    }
  }
};

/**
 * Clean up any EventBridge schedules for the tests.
 * @param {array} testScenarios
 */
const cleanUpSchedules = async (testScenarios) => {
  for (const testScenario of testScenarios) {
    await tryDeleteSchedule(testScenario.testId);
  }
};

/**
 * Clean up resources, created for test scenarios, not managed by CloudFormation.
 */
const cleanUpTestScenarioResources = async () => {
  const testScenarios = await getAllTestScenarios();
  await cleanUpSchedules(testScenarios);
  return "success";
};

const backfillTestRunCounts = async () => {
  const params = {
    TableName: DDB_TABLE,
    FilterExpression: "attribute_not_exists(totalTestRuns) AND attribute_exists(testName)",
    ProjectionExpression: "testId",
  };

  const items = [];
  do {
    const result = await dynamoDB.scan(params);
    items.push(...result.Items);
    params.ExclusiveStartKey = result.LastEvaluatedKey;
  } while (params.ExclusiveStartKey);

  if (items.length === 0) {
    console.log("No scenarios need totalTestRuns backfill");
    return "success";
  }

  console.log(`Backfilling totalTestRuns for ${items.length} scenarios`);

  for (const item of items) {
    try {
      let totalCount = 0;
      const countParams = {
        TableName: HISTORY_TABLE,
        Select: "COUNT",
        KeyConditionExpression: "#t = :t",
        ExpressionAttributeNames: { "#t": "testId" },
        ExpressionAttributeValues: { ":t": item.testId },
      };
      do {
        const countResult = await dynamoDB.query(countParams);
        totalCount += countResult.Count || 0;
        countParams.ExclusiveStartKey = countResult.LastEvaluatedKey;
      } while (countParams.ExclusiveStartKey);

      await dynamoDB.update({
        TableName: DDB_TABLE,
        Key: { testId: item.testId },
        UpdateExpression: "SET totalTestRuns = :count",
        ExpressionAttributeValues: { ":count": totalCount },
      });
    } catch (err) {
      console.error(`Failed to backfill testId ${item.testId}:`, err);
    }
  }

  console.log("Backfill complete");
  return "success";
};

module.exports = {
  cleanUpTestScenarioResources: cleanUpTestScenarioResources,
  backfillTestRunCounts: backfillTestRunCounts,
};
