// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { CloudWatchEvents } = require("@aws-sdk/client-cloudwatch-events");

const utils = require("solution-utils");

const { MAIN_REGION, DDB_TABLE: SCENARIOS_TABLE } = process.env;

const options = utils.getOptions({ region: MAIN_REGION });
const dynamoDB = DynamoDBDocument.from(new DynamoDB(options));
const cloudwatchevents = new CloudWatchEvents(options);

/**
 * Scans the scenarios DynamoDB table for configured tests.
 * Returns only testId, testName, testType, and testScenario fields.
 * Paginates automatically to retrieve all items.
 */
const getAllTestScenarios = async () => {
  const params = {
    TableName: SCENARIOS_TABLE,
    FilterExpression: "attribute_exists(testName)",
    ProjectionExpression: "testId, testName, testType, fileType, testScenario",
  };

  const items = [];
  do {
    const result = await dynamoDB.scan(params);
    items.push(...result.Items);
    params.ExclusiveStartKey = result.LastEvaluatedKey;
  } while (params.ExclusiveStartKey);

  // `testScenario` field is stored as json-string,
  // parse into a JSON object before returning.
  console.log(`Fetched ${items.length} tests from DynamoDB`);
  return items.map(scenario => ({
    ...scenario,
    testScenario: JSON.parse(scenario.testScenario)
  }));
};

/**
 * Updates the testScenario request body configuration if the following criteria match:
 * 1. testType is `simple`
 * 2. scenario.requests config exists
 * 3. requests.body is `object` type
 * Then stringifies the `object` body into a JSON string and returns the new testScenario
 * Otherwise, returns the original testScenario
 * 
 * @param {string} testName - Name of the test to update
 * @param {string} testType - Type of the test to update
 * @param {object} testScenario - Scenario Configuration of the test to update
 * 
 * @returns The updated testScenario or undefined if no updates were applicable
 */
const updateTestScenario = (testName, testType, testScenario) => {
  // Only fix tests if `testType` is simple and if scenario requests exist
  if (testType !== "simple" || !testScenario?.scenarios?.[testName]?.requests) {
    return;
  }
  testScenario.scenarios[testName].requests.forEach(requestConfig => {
    if (requestConfig.body && typeof requestConfig.body === 'object') {
      requestConfig.body = JSON.stringify(requestConfig.body)
    }
  });
  return testScenario;
}

/**
 * Sets the file type of the test, if the test is simple HTTP endpoint test, fileType is `none`,
 * if there is no fileType, then fileType is `script`
 * @param {string} testType
 * @param {string} fileType
 * @returns {string} fileType
 */
const updateFileType = (testType, fileType) => {
  if (testType === "simple" && !fileType) {
    return "none"
  }
};

/**
 * Update test configurations stored in DynamoDb if needed.
 * tests stored in DynamoDB which migrated from v3 to v4
 * have issues if the testType is `simple` because the configured
 * request body is an object. DLT v4 expects this field to be a string.
 * 
 * @param { string } testId - Id of the test to update
 * @param { string } testType - type of the test (simple, jmeter, locust, etc)
 * @param { object } testScenarios - configuration object of the test to update
 */
const updateDynamoTestConfig = async ({
  testId, testName, testType, fileType, testScenario
}) => {
  const newTestScenario = updateTestScenario(testName, testType, testScenario);
  const newFileType = updateFileType(testType, fileType);

  const expressionParts = [];
  const expressionValues = {};

  if (newTestScenario) {
    expressionParts.push("testScenario = :testScenario");
    expressionValues[":testScenario"] = JSON.stringify(newTestScenario);
  }
  if (newFileType) {
    expressionParts.push("fileType = :fileType");
    expressionValues[":fileType"] = newFileType;
  }

  if (expressionParts.length === 0) {
    console.log(`Skipping DynamoDB test config update for testId: ${testId}`)
    return;
  }

  console.log(`Updating DynamoDB test config for testId: ${testId}`);
  await dynamoDB.update({
    TableName: SCENARIOS_TABLE,
    Key: { testId },
    UpdateExpression: `SET ${expressionParts.join(", ")}`,
    ExpressionAttributeValues: expressionValues,
  });
};

/**
 * Lists EventBridge rules for a given testId and fetches their targets.
 * Each target's Input field contains the stored test configuration payload.
 * Returns an array of { rule, targets } objects.
 * 
 * @param {string} testId - Id of the test to fetch rules for
 * 
 * @returns - Rule and Targets for the test configured in EventBridge
 */
const getScheduledRules = async (testId) => {
  console.log(`Fetching EventBridge rules for testId: ${testId}`);
  const rulesResponse = await cloudwatchevents.listRules({ NamePrefix: testId });
  console.log(`Fetched ${rulesResponse.Rules.length} rules for testId: ${testId}`);
  const results = [];
  for (const rule of rulesResponse.Rules) {
    console.log(`Fetching targets for rule ${rule.Name}`);
    const targetsResponse = await cloudwatchevents.listTargetsByRule({ Rule: rule.Name });
    console.log(`Fetched ${targetsResponse.Targets.length} targets for rule ${rule.Name}`);
    results.push({
      ruleName: rule.Name,
      targets: targetsResponse.Targets,
    });
  }
  return results;
};

/**
 * Returns a list EventBridge rule targets that need to be updated.
 * The following fields may be updated:
 * 1. testScenario - follows the same update logic as the DynamoDb entry update
 * 2. if any of `cronValue`, `cronExpiryDate`, `recurrence` or `fileType` fields are falsy
 * Deletes those fields. DLT v4 enforces a specific format or enum of any of these
 * are truthy, and it also does not allow empty-string values for them.
 * 
 * @param {object[]} targets 
 * @returns 
 */
const getRuleTargetsToUpdate = (targets) => {
  const updateTargets = [];

  let shouldUpdate = false;
  for (const target of targets) {
    console.log(`Updating EventBridge rule target: ${target.Id}`);
    const input = JSON.parse(target.Input);
    const inputBodyJson = JSON.parse(input.body);
    const scenario = updateTestScenario(inputBodyJson.testName, inputBodyJson.testType, inputBodyJson.testScenario);
    if (scenario) {
      inputBodyJson.testScenario = scenario;
      shouldUpdate = true;
    }
    ['cronValue', 'cronExpiryDate', 'recurrence', 'fileType'].map(field => {
      if (inputBodyJson[field] === "" || inputBodyJson[field] === null) {
        delete inputBodyJson[field];
        shouldUpdate = true;
      }
    });
    if (shouldUpdate) {
      input.body = JSON.stringify(inputBodyJson);
      target.Input = JSON.stringify(input);
      updateTargets.push(target)
    }
    shouldUpdate = false;
  }
  return updateTargets;
}

/**
 * Fetches configured EventBridge rules and targets and updates them
 * according to the new validation logic in DLT v4.
 * 
 * @param {string} testId - Id of the test to update EventBridge rule targets for
 */
const updateEventBridgeRuleTargets = async (testId) => {
  const rules = await getScheduledRules(testId);
  for (const rule of rules) {
    const targetsToUpdate = getRuleTargetsToUpdate(rule.targets);
    if (!targetsToUpdate.length) {
      console.log(`No EventBridge rule targets to update for testId: ${testId}`)
      continue;
    }
    const targetParams = {
      Rule: rule.ruleName,
      Targets: targetsToUpdate,
    };
    console.log(`Updating targets for rule: ${rule.ruleName}`)
    await cloudwatchevents.putTargets(targetParams);
  }
}

/**
 * Updates test configurations stored in both
 * DynamoDB and EventBridge Rules
 * 
 * @param { string } testId - Id of the test to update
 * @param {string} testName - Name of the test to update
 * @param {string} testType - Type of the test to update
 * @param {object} testScenario - Scenario Configuration of the test to update
 */
const updateTestConfigs = async (scenario) => {
  console.log(`Updating test configurations for testId: ${scenario.testId}`);
  await updateDynamoTestConfig(scenario);
  await updateEventBridgeRuleTargets(scenario.testId);
};

const updateScheduledTests = async () => {
  const testScenarios = await getAllTestScenarios();
  for (const scenario of testScenarios) {
    await updateTestConfigs(scenario);
  }
}

module.exports = {
  updateScheduledTests,
};
