// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require("aws-sdk");
const utils = require("solution-utils");
const { HISTORY_TABLE, SCENARIOS_TABLE, SCENARIOS_BUCKET, STATE_MACHINE_ARN, TASK_CANCELER_ARN, STACK_ID } =
  process.env;
AWS.config.logger = console;
let options = {};
options = utils.getOptions(options);
options.region = process.env.AWS_REGION;
const s3 = new AWS.S3(options);
const lambda = new AWS.Lambda(options);
const dynamoDB = new AWS.DynamoDB.DocumentClient(options);
const stepFunctions = new AWS.StepFunctions(options);
const cloudwatchevents = new AWS.CloudWatchEvents(options);
const cloudformation = new AWS.CloudFormation(options);

/**
 * Class to throw errors
 * @param {string} code
 * @param {string} errMsg
 */
class ErrorException {
  constructor(code, errMsg) {
    this.code = code;
    this.message = errMsg;
    this.status = 400;
  }
}

/**
 * Get URL for the regional CloudFormation template from the main CloudFormation stack exports
 * @returns {string} The S3 URL for the modified regional CloudFormation template
 */
const getCFUrl = async () => {
  let exports = [];
  let params = {};
  try {
    do {
      const listExports = await cloudformation.listExports(params).promise();
      exports.push(...listExports.Exports);
      params.NextToken = listExports.NextToken;
    } while (params.NextToken);
    const result = exports.find((entry) => entry.ExportingStackId === STACK_ID && entry.Name === "RegionalCFTemplate");
    return result.Value;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Returns test resource information for all configured regions
 * @returns {object} Test infrastructure configuration for every configured region
 */
const getAllRegionConfigs = async () => {
  let response = [];
  const params = {
    TableName: SCENARIOS_TABLE,
    Select: "ALL_ATTRIBUTES",
    ScanFilter: {
      testId: {
        ComparisonOperator: "BEGINS_WITH",
        AttributeValueList: ["region"],
      },
      taskCluster: {
        ComparisonOperator: "NE",
        AttributeValueList: [""],
      },
    },
  };
  try {
    do {
      const regionConfigs = await dynamoDB.scan(params).promise();
      response.push(...regionConfigs.Items);
      params.ExclusiveStartKey = regionConfigs.LastEvaluatedKey;
    } while (params.ExclusiveStartKey);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Returns the dynamoDB entry for a given testId
 * @param {string} testId
 * @returns {object} Test configuration stored in DynamoDB
 */
const getTestEntry = async (testId) => {
  try {
    let params = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: testId,
      },
    };
    const response = await dynamoDB.get(params).promise();
    return response.Item;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Return test resource information for a given region
 * @param {string} testRegion
 * @returns {object} Test infrastructure configuration for specified region
 */
const getRegionInfraConfigs = async (testRegion) => {
  try {
    let regionalParameters = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: `region-${testRegion}`,
      },
    };
    const ddbEntry = await dynamoDB.get(regionalParameters).promise();
    if (!("Item" in ddbEntry)) {
      const errorMessage = "The region requested does not have a stored infrastructure configuration.";
      console.error(errorMessage);
      throw new ErrorException("InvalidRegionRequest", errorMessage);
    }
    return ddbEntry.Item;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Retrieves all information needed to run a test, including
 * regional testing infrastructure configuration,
 * based on testId
 * @param {string} testId
 * @returns {object} Combined test configuration and test infrastructure configuration for regions to be tested
 */
const getTestAndRegionConfigs = async (testId) => {
  try {
    const testEntry = await getTestEntry(testId);
    if (testEntry.testTaskConfigs) {
      for (let testRegionSettings of testEntry.testTaskConfigs) {
        const regionInfraConfig = await getRegionInfraConfigs(testRegionSettings.region);
        Object.assign(testRegionSettings, regionInfraConfig);
      }
    }
    return testEntry;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * getTestHistoryEntries
 * @param {string} testId
 * @returns {object} List of all history objects for testId
 */
const getTestHistoryEntries = async (testId) => {
  try {
    let response = [];
    const params = {
      TableName: HISTORY_TABLE,
      Select: "ALL_ATTRIBUTES",
      KeyConditionExpression: "#t = :t",
      ExpressionAttributeNames: {
        "#t": "testId",
      },
      ExpressionAttributeValues: {
        ":t": testId,
      },
    };
    do {
      const historyEntries = await dynamoDB.query(params).promise();
      response.push(...historyEntries.Items);
      params.ExclusiveStartKey = historyEntries.LastEvaluatedKey;
    } while (params.ExclusiveStartKey);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Creates a list of all test scenarios
 * @returns {object} All created tests
 */
const listTests = async () => {
  console.log("List tests");

  try {
    const response = { Items: [] };
    const params = {
      TableName: SCENARIOS_TABLE,
      AttributesToGet: [
        "testId",
        "testName",
        "testDescription",
        "status",
        "startTime",
        "nextRun",
        "scheduleRecurrence",
      ],
      ScanFilter: {
        testId: {
          ComparisonOperator: "NOT_CONTAINS",
          AttributeValueList: ["region"],
        },
      },
    };
    do {
      const testScenarios = await dynamoDB.scan(params).promise();
      response.Items.push(...testScenarios.Items);
      params.ExclusiveStartKey = testScenarios.LastEvaluatedKey;
    } while (params.ExclusiveStartKey);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Schedules test and returns a consolidated list of test scenarios
 * @param {object} event test event information
 * @param {object} context the lambda context information
 * @returns A map of attribute values in Dynamodb after scheduled.
 */
const scheduleTest = async (event, context) => {
  try {
    let config = JSON.parse(event.body);
    const { testId, scheduleDate, scheduleTime, showLive } = config;
    const [hour, minute] = scheduleTime.split(":");
    let [year, month, day] = scheduleDate.split("-");
    let nextRun = `${year}-${month}-${day} ${hour}:${minute}:00`;
    const functionName = context.functionName;
    const functionArn = context.functionArn;
    let scheduleRecurrence = "";

    //check if rule exists, delete rule if exists
    let rulesResponse = await cloudwatchevents.listRules({ NamePrefix: testId }).promise();

    for (let rule of rulesResponse.Rules) {
      let ruleName = rule.Name;
      await cloudwatchevents.removeTargets({ Rule: ruleName, Ids: [ruleName] }).promise();
      await lambda.removePermission({ FunctionName: functionName, StatementId: ruleName }).promise();
      await cloudwatchevents.deleteRule({ Name: ruleName }).promise();
    }

    if (config.scheduleStep === "create") {
      const createRun = new Date(year, parseInt(month, 10) - 1, day, hour, minute);
      // Schedule for 1 min prior to account for time it takes to create rule
      // getMonth() returns Jan with index Zero that is why months need a +1
      // refrence https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getMonth
      createRun.setMinutes(createRun.getMinutes() - 1);
      const cronStart = `cron(${createRun.getMinutes()} ${createRun.getHours()} ${createRun.getDate()} ${
        createRun.getMonth() + 1
      } ? ${createRun.getFullYear()})`;
      scheduleRecurrence = config.recurrence;

      //Create rule to create schedule
      const createRuleParams = {
        Name: `${testId}Create`,
        Description: `Create test schedule for: ${testId}`,
        ScheduleExpression: cronStart,
        State: "ENABLED",
      };
      let ruleArn = await cloudwatchevents.putRule(createRuleParams).promise();

      //Add permissions to lambda
      let permissionParams = {
        Action: "lambda:InvokeFunction",
        FunctionName: functionName,
        Principal: "events.amazonaws.com",
        SourceArn: ruleArn.RuleArn,
        StatementId: `${testId}Create`,
      };
      await lambda.addPermission(permissionParams).promise();

      //modify schedule step in input params
      config.scheduleStep = "start";
      event.body = JSON.stringify(config);

      //add target
      let createTargetParams = {
        Rule: `${testId}Create`,
        Targets: [
          {
            Arn: functionArn,
            Id: `${testId}Create`,
            Input: JSON.stringify(event),
          },
        ],
      };
      await cloudwatchevents.putTargets(createTargetParams).promise();
    } else {
      //create schedule expression
      let scheduleString;
      if (config.recurrence) {
        scheduleRecurrence = config.recurrence;
        switch (config.recurrence) {
          case "daily":
            scheduleString = "rate(1 day)";
            break;
          case "weekly":
            scheduleString = "rate(7 days)";
            break;
          case "biweekly":
            scheduleString = "rate(14 days)";
            break;
          case "monthly":
            scheduleString = `cron(${minute} ${hour} ${day} * ? *)`;
            break;
          default:
            throw new ErrorException("InvalidParameter", "Invalid recurrence value.");
        }
      } else {
        scheduleString = `cron(${minute} ${hour} ${day} ${month} ? ${year})`;
      }

      //Create rule to run on schedule
      const ruleParams = {
        Name: `${testId}Scheduled`,
        Description: `Scheduled tests for ${testId}`,
        ScheduleExpression: scheduleString,
        State: "ENABLED",
      };
      let ruleArn = await cloudwatchevents.putRule(ruleParams).promise();

      //Add permissions to lambda
      let permissionParams = {
        Action: "lambda:InvokeFunction",
        FunctionName: functionName,
        Principal: "events.amazonaws.com",
        SourceArn: ruleArn.RuleArn,
        StatementId: `${testId}Scheduled`,
      };
      await lambda.addPermission(permissionParams).promise();

      //remove schedule step in params
      delete config.scheduleStep;
      event.body = JSON.stringify(config);

      //add target to rule
      let targetParams = {
        Rule: `${testId}Scheduled`,
        Targets: [
          {
            Arn: functionArn,
            Id: `${testId}Scheduled`,
            Input: JSON.stringify(event),
          },
        ],
      };
      await cloudwatchevents.putTargets(targetParams).promise();

      //Remove rule created during create schedule step
      if (config.recurrence) {
        let ruleName = `${testId}Create`;
        await cloudwatchevents.removeTargets({ Rule: ruleName, Ids: [ruleName] }).promise();
        await lambda.removePermission({ FunctionName: functionName, StatementId: ruleName }).promise();
        await cloudwatchevents.deleteRule({ Name: ruleName }).promise();
      }
    }

    //Update DynamoDB if table was not already updated by "create" schedule step
    if (config.scheduleStep || !config.recurrence) {
      let params = {
        TableName: SCENARIOS_TABLE,
        Key: {
          testId: testId,
        },
        UpdateExpression:
          "set #n = :n, #d = :d, #tc = :tc, #t = :t, #s = :s, #r = :r, #st = :st, #et = :et, #nr = :nr, #sr = :sr, #sl = :sl, #tt = :tt, #ft = :ft",
        ExpressionAttributeNames: {
          "#n": "testName",
          "#d": "testDescription",
          "#tc": "testTaskConfigs",
          "#t": "testScenario",
          "#s": "status",
          "#r": "results",
          "#st": "startTime",
          "#et": "endTime",
          "#nr": "nextRun",
          "#sr": "scheduleRecurrence",
          "#sl": "showLive",
          "#tt": "testType",
          "#ft": "fileType",
        },
        ExpressionAttributeValues: {
          ":n": config.testName,
          ":d": config.testDescription,
          ":tc": config.testTaskConfigs,
          ":t": JSON.stringify(config.testScenario),
          ":s": "scheduled",
          ":r": {},
          ":st": "",
          ":et": "",
          ":nr": nextRun,
          ":sr": scheduleRecurrence,
          ":sl": showLive,
          ":tt": config.testType,
          ":ft": config.fileType,
        },
        ReturnValues: "ALL_NEW",
      };
      let data = await dynamoDB.update(params).promise();

      console.log(`Schedule test complete: ${JSON.stringify(data, null, 2)}`);

      return data.Attributes;
    } else {
      console.log(`Succesfully created schedule rule for test: ${testId}`);
    }
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Sets the file type of the test, if the test is simple HTTP endpoint test, fileType is `none`,
 * if there is no fileType, then fileType is `script`
 * @param {string} testType
 * @param {string} fileType
 * @returns {string} fileType
 */
const setFileType = (testType, fileType) => {
  // When no fileType, fileType is script.
  if (testType === "simple") {
    fileType = "none";
  } else if (!fileType) {
    fileType = "script";
  }
  return fileType;
};

/**
 * Generates the testId if one does not exist
 * @param {string} testId
 * @returns generated unique ID
 */
const setTestId = (testId) =>
  // When accessing API directly and no testId
  testId || utils.generateUniqueId(10);

/**
 * Sets the next schedule test run
 * @param {Date} scheduledTime
 * @param {string} scheduleRecurrence
 * @returns nextRun
 */
const setNextRun = (scheduledTime, scheduleRecurrence = "") => {
  let newDate = new Date(scheduledTime.getTime());
  if (!scheduleRecurrence) {
    return "";
  }
  switch (scheduleRecurrence) {
    case "daily":
      newDate.setDate(newDate.getDate() + 1);
      break;
    case "weekly":
      newDate.setDate(newDate.getDate() + 7);
      break;
    case "biweekly":
      newDate.setDate(newDate.getDate() + 14);
      break;
    case "monthly":
      newDate.setMonth(newDate.getMonth() + 1);
      break;
    default:
      throw new ErrorException("InvalidParameter", "Invalid recurrence value.");
  }
  return convertDateToString(newDate);
};
/**
 * Validates the setting for task count and task concurrency
 * @param {object} testTaskConfigs
 * @returns testTaskConfigs
 */
const validateTaskCountConcurrency = (testTaskConfigs, regionalTaskDetails) => {
  // For each regional config, parse the task count and concurrency
  for (const regionalTestConfig of testTaskConfigs) {
    const region = regionalTestConfig.region;
    const availableTasks = parseInt(regionalTaskDetails[region].dltAvailableTasks);
    if (typeof regionalTestConfig.taskCount === "string") {
      regionalTestConfig.taskCount = regionalTestConfig.taskCount.trim();
    }
    const taskCount = parseInt(regionalTestConfig.taskCount);
    if (isNaN(taskCount) || parseInt(taskCount) < 1 || parseInt(taskCount) > availableTasks) {
      throw new ErrorException(
        "InvalidParameter",
        `Task count should be positive number between 1 to ${availableTasks}.`
      );
    }
    regionalTestConfig.taskCount = taskCount;

    if (typeof regionalTestConfig.concurrency === "string") {
      regionalTestConfig.concurrency = regionalTestConfig.concurrency.trim();
    }
    const concurrency = parseInt(regionalTestConfig.concurrency);
    if (isNaN(concurrency) || parseInt(regionalTestConfig.concurrency) < 1) {
      throw new ErrorException("InvalidParameter", "Concurrency should be positive number");
    }
    regionalTestConfig.concurrency = parseInt(concurrency);
  }
  return testTaskConfigs;
};

/**
 * Validation that there is a value for a given key
 * @param {object} patterns
 * @param {string} key
 * @throws InvalidParameter if the value of the key is invalid
 */
const validateParameter = (patterns, key) => {
  if (patterns.length === 0 || patterns.length % 2 !== 0) {
    throw new ErrorException("InvalidParameter", `Invalid ${key} value.`);
  }
};

/**
 * Validation for the execution value
 * @param {string} result
 * @param {string} key
 * @param {number} value
 * @param {number} min
 * @throws InvalidParameter if the value is not a positive number less than the minimum
 * @returns value
 */
const validateNumber = (result, key, value, min) => {
  // Number
  if (isNaN(value) || parseInt(value) < min) {
    throw new ErrorException("InvalidParameter", `${key} should be positive number equal to or greater than ${min}.`);
  }
  return `${result}${parseInt(value)}`;
};

/**
 * validateUnit
 * For execution values like ramp-up and hold-for, validates the time units
 * @param {string} result test result
 * @param {string} key test result key
 * @param {string} value test result value with time units
 *
 */
const validateUnit = (result, key, value) => {
  const timeUnits = ["ms", "s", "m", "h", "d"];
  // Unit
  if (!timeUnits.includes(value)) {
    throw new ErrorException("InvalidParameter", `${key} unit should be one of these: ms, s, m, h, d.`);
  }
  return `${result}${value}`;
};

/**
 *
 * @param {object} testScenario
 * @param {string} key
 * @returns
 */
const formatStringKey = (testScenario, key) => {
  if (typeof testScenario.execution[0][key] === "string") {
    testScenario.execution[0][key] = testScenario.execution[0][key].replace(/\s/g, "");
  }
  return testScenario;
};

/**
 *
 * @param {string} testDuration
 */
const getTestDurationSeconds = (testDuration) => {
  const splitDurationRegex = /[a-z]+|\d+/gi;
  const [durationValue, durationUnit] = testDuration.match(splitDurationRegex);
  if (durationUnit === "s") {
    return parseInt(durationValue);
  } else if (durationUnit === "m") {
    return parseInt(durationValue) * 60;
  } else {
    throw new ErrorException("InvalidParameter", "Invalid hold-for unit, it should be either m or s.");
  }
};

/**
 * Validates if time unit are valid.
 * @param {object} testScenario
 * @param {string} key Key to validate (ramp-up, hold-for)
 * @param {number} min Minimum number for the value
 */
const validateTimeUnit = (testScenario, key, min) => {
  const timeRegex = /[a-z]+|[^a-z]+/gi;
  testScenario = formatStringKey(testScenario, key);

  if (isNaN(testScenario.execution[0][key])) {
    let patterns = testScenario.execution[0][key].match(timeRegex);
    validateParameter(patterns, key);

    let result = "";
    for (let i = 0, length = patterns.length; i < length; i++) {
      let value = patterns[i];
      if (i % 2 === 0) {
        result = validateNumber(result, key, value, min);
      } else {
        result = validateUnit(result, key, value);
      }
    }
    testScenario.execution[0][key] = result;
  } else {
    testScenario.execution[0][key] = parseInt(testScenario.execution[0][key]);
    if (testScenario.execution[0][key] < min) {
      throw new ErrorException("InvalidParameter", `${key} should be positive number equal to or greater than ${min}.`);
    }
  }
  return testScenario;
};

/**
 *
 * @param {object} testTaskConfigs
 * @param {object} testScenario
 * @param {string} testId
 */
const writeTestScenarioToS3 = async (testTaskConfigs, testScenario, testId) => {
  // 1. Write test scenario to S3 for each region
  try {
    const s3Promises = testTaskConfigs.map((testTaskConfig) => {
      const testScenarioS3 = testScenario;
      testScenarioS3.execution[0].taskCount = testTaskConfig.taskCount;
      testScenarioS3.execution[0].concurrency = testTaskConfig.concurrency;
      const params = {
        Body: JSON.stringify(testScenarioS3),
        Bucket: SCENARIOS_BUCKET,
        Key: `test-scenarios/${testId}-${testTaskConfig.region}.json`,
      };
      return s3.putObject(params).promise();
    });
    await Promise.all(s3Promises);
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 *
 * @param {object} testTaskConfigs
 * @returns the scheduled test config for tasks and regional
 *          ecs infrastructure configuration in one object
 */
const mergeTestAndInfraConfiguration = async (testTaskConfigs) => {
  const regionalTestAndInfraConfiguration = [];
  for (const regionalTestConfig of testTaskConfigs) {
    const regionalInfraConfiguration = await getRegionInfraConfigs(regionalTestConfig.region);
    regionalTestAndInfraConfiguration.push({
      ...regionalTestConfig,
      ...regionalInfraConfiguration,
    });
  }
  return regionalTestAndInfraConfiguration;
};

/**
 * startStepFunctionExecution
 * Kicks off the step function state machine for the test run
 * @param {object} stepFunctionParams
 */
const startStepFunctionExecution = async (stepFunctionParams) => {
  try {
    const prefix = new Date().toISOString().replace("Z", "").split("").reverse().join("");
    await stepFunctions
      .startExecution({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify({
          ...stepFunctionParams,
          prefix,
        }),
      })
      .promise();
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 *
 * @param {object} updateTestConfigs
 * @returns
 */
const updateTestDBEntry = async (updateTestConfigs) => {
  try {
    const {
      testId,
      testName,
      testDescription,
      testTaskConfigs,
      testScenario,
      startTime,
      nextRun,
      scheduleRecurrence,
      showLive,
      testType,
      fileType,
    } = updateTestConfigs;
    const params = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: testId,
      },
      UpdateExpression:
        "set #n = :n, #d = :d, #tc = :tc, #t = :t, #s = :s, #r = :r, #st = :st, #et = :et, #nr = :nr, #sr = :sr, #sl = :sl, #tt = :tt, #ft = :ft",
      ExpressionAttributeNames: {
        "#n": "testName",
        "#d": "testDescription",
        "#tc": "testTaskConfigs",
        "#t": "testScenario",
        "#s": "status",
        "#r": "results",
        "#st": "startTime",
        "#et": "endTime",
        "#nr": "nextRun",
        "#sr": "scheduleRecurrence",
        "#sl": "showLive",
        "#tt": "testType",
        "#ft": "fileType",
      },
      ExpressionAttributeValues: {
        ":n": testName,
        ":d": testDescription,
        ":tc": testTaskConfigs,
        ":t": JSON.stringify(testScenario),
        ":s": "running",
        ":r": {},
        ":st": startTime,
        ":et": "running",
        ":nr": nextRun,
        ":sr": scheduleRecurrence,
        ":sl": showLive,
        ":tt": testType,
        ":ft": fileType,
      },
      ReturnValues: "ALL_NEW",
    };
    return dynamoDB.update(params).promise();
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * @function convertDateToString
 * Description: Formats the date to a YYYY-MM-DD HH:MM:SS format
 * @config {string} a formatted string date
 *  */
const convertDateToString = (date) => {
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
};

/**
 * @function createTest
 * Description: returns a consolidated list of test scenarios
 * @config {object} test scenario configuration
 */
const createTest = async (config) => {
  console.log(`Create test: ${JSON.stringify(config, null, 2)}`);
  try {
    const { testName, testDescription, testType, showLive, regionalTaskDetails } = config;
    let { testId, testScenario, testTaskConfigs, fileType, scheduleTime, eventBridge, recurrence } = config;
    let nextRun;
    fileType = setFileType(testType, fileType);
    testId = setTestId(testId);

    const testEntry = await getTestEntry(testId);
    if (testEntry && testEntry.nextRun) nextRun = new Date(testEntry.nextRun);

    let startTime = new Date();

    if (eventBridge) {
      const startDate = new Date().toISOString().slice(0, 10);
      // If it is eventBridge triggered definitely has scheduleTime
      startTime = new Date(`${startDate} ${scheduleTime}:00`);
    }

    if (nextRun && startTime < nextRun) nextRun = convertDateToString(nextRun);
    else nextRun = setNextRun(startTime, recurrence);

    const scheduleRecurrence = recurrence ? recurrence : "";
    startTime = convertDateToString(startTime);

    testTaskConfigs = validateTaskCountConcurrency(testTaskConfigs, regionalTaskDetails);

    // Ramp up
    testScenario = validateTimeUnit(testScenario, "ramp-up", 0);

    // Hold for
    testScenario = validateTimeUnit(testScenario, "hold-for", 1);

    // Add reporting to Test Scenario so that the end results are export to
    // Amazon s3 by each task.
    testScenario.reporting = [
      {
        module: "final-stats",
        summary: true,
        percentiles: true,
        "summary-labels": true,
        "test-duration": true,
        "dump-xml": "/tmp/artifacts/results.xml",
      },
    ];

    console.log("TEST:: ", JSON.stringify(testScenario, null, 2));

    // 1. Write test scenario to S3
    await writeTestScenarioToS3(testTaskConfigs, testScenario, testId);

    console.log(`test scenario uploaded to s3: test-scenarios/${testId}.json`);

    // Based on the selected regions for the test, retrieve the test infrastructure configuration
    // for each region and create an object for the specific region and add it to the list sent to the step functions
    const regionalTestAndInfraConfiguration = await mergeTestAndInfraConfiguration(testTaskConfigs);

    /**
     * Start Step Functions execution
     */
    const testDuration = getTestDurationSeconds(testScenario.execution[0]["hold-for"]);
    const stepFunctionParams = {
      testTaskConfig: regionalTestAndInfraConfiguration,
      testId,
      testType,
      fileType,
      showLive,
      testDuration,
    };
    await startStepFunctionExecution(stepFunctionParams);

    // Update DynamoDB values.
    const updateDBData = {
      testId,
      testName,
      testDescription,
      testTaskConfigs,
      testScenario,
      startTime,
      nextRun,
      scheduleRecurrence,
      showLive,
      testType,
      fileType,
    };

    const data = await updateTestDBEntry(updateDBData);

    console.log(`Create test complete: ${JSON.stringify(data)}`);

    return data.Attributes;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 *
 * @param {object} ecs The client is created in the region in which the tasks are running
 * @param {Array} tasks List of tasks
 * @param {string} taskCluster Name of ECS cluster
 * @param {object} tasksInRegion Object storing the region the tasks are running in
 * @returns object with region and tasks in region
 */

const getRunningTasks = async (ecs, tasks, taskCluster, tasksInRegion) => {
  const params = {
    cluster: taskCluster,
  };
  let describeTasksResponse;
  while (tasks.length > 0) {
    //get groups of 100 tasks
    params.tasks = tasks.splice(0, 100);
    describeTasksResponse = await ecs.describeTasks(params).promise();
    //add tasks to returned value for use in UI
    tasksInRegion.tasks = tasksInRegion.tasks.concat(describeTasksResponse.tasks);
  }
  return tasksInRegion;
};

/**
 *
 * @param {object} ecs The client is created in the region in which the tasks are running
 * @param {string} taskCluster Name of ECS cluster
 * @param {string} testId
 * @returns array of task ARNs
 */

const getListOfTasksInRegion = async (ecs, taskCluster, testId) => {
  let params = {
    cluster: taskCluster,
    startedBy: testId,
  };
  let tasks = [];
  let tasksResponse;
  do {
    tasksResponse = await ecs.listTasks(params).promise();
    tasks = tasks.concat(tasksResponse.taskArns);
    params.nextToken = tasksResponse.nextToken;
  } while (tasksResponse.nextToken);
  return tasks;
};

/**
 *
 * @param {object} data
 * @param {string} testId
 * @returns test run data augmented with tasks running per region, if any
 */
const listTasksPerRegion = async (data, testId) => {
  for (const testRegion of data.testTaskConfigs) {
    if (testRegion.taskCluster) {
      const region = testRegion.region;
      let tasksInRegion = { region: region };
      tasksInRegion.tasks = [];
      options.region = region;
      const ecs = new AWS.ECS(options);
      const tasks = await getListOfTasksInRegion(ecs, testRegion.taskCluster, testId);
      if (tasks.length !== 0) {
        tasksInRegion = await getRunningTasks(ecs, tasks, testRegion.taskCluster, tasksInRegion);
      }
      data.tasksPerRegion = data.tasksPerRegion.concat(tasksInRegion);
    } else {
      const errorMessage = new ErrorException(
        "InvalidInfrastructureConfiguration",
        `There is no ECS test infrastructure configured for region ${testRegion.region}`
      );
      console.log(errorMessage);
      throw errorMessage;
    }
  }
  return data;
};

/**
 * @function getTest
 * Description: returns all data related to a specific testId
 * @testId {string} the unique id of test scenario to return.
 */
const getTest = async (testId) => {
  console.log(`Get test details for testId: ${testId}`);

  try {
    //Retrieve test and regional resource information from DDB
    let data = await getTestAndRegionConfigs(testId);

    data.testScenario = JSON.parse(data.testScenario);

    if (data.status === "running") {
      console.log(`testId: ${testId} is still running`);

      // Get the list of tasks for testId for each test region
      data.tasksPerRegion = [];
      if (data.testTaskConfigs) {
        data = await listTasksPerRegion(data, testId);
      } else {
        const errorMessage = new ErrorException(
          "InvalidConfiguration",
          "There are no test task configurations for the test."
        );
        console.log(errorMessage);
        throw errorMessage;
      }
    }
    data.history = await getTestHistoryEntries(testId);
    return data;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * deleteDDBTestEntry
 * Deleting the DDB test entry
 * @param {string} testId
 */
const deleteDDBTestEntry = async (testId) => {
  try {
    const params = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: testId,
      },
    };
    await dynamoDB.delete(params).promise();
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * getTestHistoryTestRunIds
 * @param {string} testId
 * @returns list of all history objects for testId
 */
const getTestHistoryTestRunIds = async (testId) => {
  try {
    let response = [];
    const params = {
      TableName: HISTORY_TABLE,
      KeyConditionExpression: "#t = :t",
      ExpressionAttributeNames: {
        "#t": "testId",
      },
      ExpressionAttributeValues: {
        ":t": testId,
      },
    };
    do {
      const testRunIds = await dynamoDB.query(params).promise();
      testRunIds.Items.forEach((testRunItem) => {
        response.push(testRunItem.testRunId);
      });
      params.ExclusiveStartKey = testRunIds.LastEvaluatedKey;
    } while (params.ExclusiveStartKey);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * The DynamoDB batch write API expected the delete request to have a specific format
 * This function creates a list of entries formatted as required for all test run entries
 * @param {string} testId
 * @param {object} testRunItems
 * @returns List of batch DeleteRequest items
 */
const createBatchRequestItems = (testId, testRunItems) =>
  testRunItems.map((testRunItem) => ({ DeleteRequest: { Key: { testId: testId, testRunId: testRunItem } } }));

/**
 * Batch delete of history test runs
 * If there are some unprocessed items, calls itself to run again
 * @param {object} deleteItems
 */
const deleteTestHistory = async (deleteItems) => {
  try {
    const batchRequestItem = {};
    if (!Array.isArray(deleteItems)) {
      deleteItems = [deleteItems];
    }
    batchRequestItem[HISTORY_TABLE] = deleteItems;
    const params = {
      RequestItems: batchRequestItem,
    };
    const response = await dynamoDB.batchWrite(params).promise();
    if (Object.keys(response.UnprocessedItems).length > 0) {
      deleteTestHistory(response.UnprocessedItems);
    }
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * The DynamoDB batch write API limits batch write items to 25
 * This function parses the formatted delete requests into a max of 25 item chunks
 * @param {object} testRuns
 */
const parseBatchRequests = async (testRuns) => {
  while (testRuns.length > 0) {
    await deleteTestHistory(testRuns.splice(0, 25));
  }
};

const deleteMetricFilter = async (testId, taskCluster, ecsCloudWatchLogGroup) => {
  const metrics = ["numVu", "numSucc", "numFail", "avgRt"];
  const cloudwatchLogs = new AWS.CloudWatchLogs(options);

  for (let metric of metrics) {
    console.log("deleting metric filter:", `${taskCluster}-Ecs${metric}-${testId}`);
    let deleteMetricFilterParams = {
      filterName: `${taskCluster}-Ecs${metric}-${testId}`,
      logGroupName: ecsCloudWatchLogGroup,
    };
    try {
      await cloudwatchLogs.deleteMetricFilter(deleteMetricFilterParams).promise();
    } catch (e) {
      if (e.code === "ResourceNotFoundException") {
        console.error("metric filter", `${taskCluster}-Ecs${metric}-${testId}`, "does not exist");
      } else {
        throw e;
      }
    }
  }
};

/**
 * Deletes the metric filter created for the test run in all configured regions
 * @param {string} testId
 * @param {object} testAndRegionalInfraConfigs
 */
const deleteDashboards = async (testId, testAndRegionalInfraConfigs) => {
  //delete metric filter, if no metric filters log error and continue delete
  const dashboardNames = [];
  if (!testAndRegionalInfraConfigs.testTaskConfigs) return;
  try {
    for (const regionConfig of testAndRegionalInfraConfigs.testTaskConfigs) {
      dashboardNames.push(`EcsLoadTesting-${testId}-${regionConfig.region}`);
      options.region = regionConfig.region;
      const cloudwatch = new AWS.CloudWatch(options);
      await deleteMetricFilter(testId, regionConfig.taskCluster, regionConfig.ecsCloudWatchLogGroup);
      //Delete Dashboard
      console.log("deleting dash:", dashboardNames);
      const deleteDashboardParams = { DashboardNames: dashboardNames };
      await cloudwatch.deleteDashboards(deleteDashboardParams).promise();
    }
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Deletes all data related to a specific testId
 * @param {string} testId the unique id of test scenario to delete
 * @param {string} functionName the name of the task runner lambda function
 * @returns Success
 */
const deleteTest = async (testId, functionName) => {
  console.log(`Delete test, testId: ${testId}`);
  // Get test regions then get config info
  // Get test and regional test infrastructure configuration
  const testAndRegionalInfraConfigs = await getTestAndRegionConfigs(testId);
  await deleteDashboards(testId, testAndRegionalInfraConfigs);

  try {
    //Get Rules
    let rulesResponse = await cloudwatchevents.listRules({ NamePrefix: testId }).promise();
    //Delete Rule
    for (let rule of rulesResponse.Rules) {
      let ruleName = rule.Name;
      await cloudwatchevents.removeTargets({ Rule: ruleName, Ids: [ruleName] }).promise();
      await lambda.removePermission({ FunctionName: functionName, StatementId: ruleName }).promise();
      await cloudwatchevents.deleteRule({ Name: ruleName }).promise();
    }
    await deleteDDBTestEntry(testId);
    const testRunIds = await getTestHistoryTestRunIds(testId);
    const testRuns = createBatchRequestItems(testId, testRunIds);
    await parseBatchRequests(testRuns);
    return "success";
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Stop all tasks related to a specific testId, updates test status in Dynamodb
 * @param {string} testId the unique id of test scenario to stop.
 * @returns Test cancelling
 */
const cancelTest = async (testId) => {
  console.log(`Cancel test for testId: ${testId}`);

  try {
    // Get test and regional infrastructure configuration
    const testAndRegionalInfraConfigs = await getTestAndRegionConfigs(testId);
    if (testAndRegionalInfraConfigs.testTaskConfigs) {
      for (const regionalConfig of testAndRegionalInfraConfigs.testTaskConfigs) {
        //cancel tasks
        const taskCancelerParams = {
          FunctionName: TASK_CANCELER_ARN,
          InvocationType: "Event",
          Payload: JSON.stringify({
            testId: testId,
            testTaskConfig: regionalConfig,
          }),
        };
        await lambda.invoke(taskCancelerParams).promise();
      }
    }

    //Update the status in the scenarios table.
    const params = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: testId,
      },
      UpdateExpression: "set #s = :s",
      ExpressionAttributeNames: {
        "#s": "status",
      },
      ExpressionAttributeValues: {
        ":s": "cancelling",
      },
    };
    await dynamoDB.update(params).promise();

    return "test cancelling";
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Returns a list of ecs tasks
 * @returns A list of task ARNs by test region
 */
const listTasks = async () => {
  console.log("Collect all running tasks in all regions");
  try {
    let regionalTaskArns = [];
    const regionalConfigs = await getAllRegionConfigs();
    //Get list of running tasks
    for (const regionalConfig of regionalConfigs) {
      const regionalTasks = { region: regionalConfig.region };
      options.region = regionalConfig.region;
      let params = {
        cluster: regionalConfig.taskCluster,
      };
      const ecs = new AWS.ECS(options);
      const taskArns = [];
      do {
        let data = await ecs.listTasks(params).promise();
        taskArns.push(...data.taskArns);
        params.nextToken = data.nextToken;
      } while (params.nextToken);
      regionalTasks.taskArns = taskArns;
      regionalTaskArns.push(regionalTasks);
    }
    return regionalTaskArns;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Splits an array into subarrays with a maximum length of maxLength. Useful for
 * when an API has a limit to how much can be requested with a single call.
 * @param {array} array the array that needs to be split up
 * @param {int} maxLength the maximum a
 * @returns {array<array>} an array of arrays where the length of each sub array is maxLength
 *          except the last one
 */
const splitArrayBySize = (array, maxLength) => {
  const subArrays = [];
  for (let i = 0; i < array.length; i += maxLength) {
    const subArray = array.slice(i, i + maxLength);
    subArrays.push(subArray);
  }
  return subArrays;
};

/**
 * Will call an API and aggregate the wanted data until nextToken is no longer
 * defined. The AWS API limits how much is returned by a single API call
 * (usually 100 values) meaning subsequent calls are often needed.
 * @param {function} apiCall the AWS API call to get all data from. Wrapping the
 *        AWS API call in a function might be needed.
 * @param {Object} params the parameters that should be passed to the AWS API call
 * @param {string} dataKeyOfInterest the key of the value that is going to be
 *        aggregated and returned
 * @returns {Promise<array>} array of all the values provided by dataKeyOfInterest from
 *        the API responses
 */
const getAllAPIData = async (apiCall, params, dataKeyOfInterest) => {
  const apiParams = JSON.parse(JSON.stringify(params)); // to avoid fn side effects
  let aggregatedData = [];
  let apiResponse;

  try {
    do {
      apiResponse = await apiCall(apiParams);

      aggregatedData = aggregatedData.concat(apiResponse[dataKeyOfInterest]);
      apiParams.nextToken = apiResponse.nextToken;
    } while (apiResponse.nextToken);

    return aggregatedData;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

/**
 * Waits for all promises an array to finish then aggregates the results into a
 * single array. If any of the promises fails then an empty array is returned.
 * @param {array<Promise>} jsPromises an array of promises
 * @returns {Promise<array>} array of all the outputs from the promises
 */
const getAllPromiseResults = async (jsPromises) => {
  const promiseResults = await Promise.all(jsPromises);

  let allResults = [];
  promiseResults.forEach((result) => (allResults = allResults.concat(result)));
  return allResults;
};

/**
 * Grabs users Fargate vCPU limit for the region specified by the AWS.ServiceQuota parameter
 * @param {AWS.ServiceQuota} servicequotas an instance of ServiceQuotas with the proper region to make the API calls from
 * @returns {Promise<int>} the number of vCPUs allowed for a given region
 */
const getRegionFargatevCPULimit = async (servicequotas) => {
  console.log("Getting the users Fargate vCPU limit from ServiceQuotas");
  try {
    const sqParams = { ServiceCode: "fargate", QuotaCode: "L-3032A538" };
    const sqData = await servicequotas.getServiceQuota(sqParams).promise();

    return sqData.Quota.Value;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Returns the descriptions of all Fargate tasks within a cluster
 * @param {AWS.ECS} ecs an instance of ECS to make the API calls from
 * @param {string} clusterArn the cluster in question
 * @returns {Promise<array>} array of descriptions for the Fargate tasks
 */
const describeTasksInCluster = async (ecs, clusterArn) => {
  console.log("Describing all the Fargate tasks within a cluster");
  const ecsListTasks = async (params) => ecs.listTasks(params).promise(); // wrap API call to be passed to a function
  const API_REQUEST_LIMIT = 100; // AWS API calls can only request 100

  try {
    const tasks = await getAllAPIData(ecsListTasks, { cluster: clusterArn, launchType: "FARGATE" }, "taskArns");

    const taskDetailPromises = [];
    splitArrayBySize(tasks, API_REQUEST_LIMIT).forEach((taskArray) => {
      const describeTaskPromise = ecs
        .describeTasks({ cluster: clusterArn, tasks: taskArray })
        .promise()
        .then((apiResponse) => apiResponse.tasks);
      taskDetailPromises.push(describeTaskPromise);
    });
    const allTaskDetails = await getAllPromiseResults(taskDetailPromises);
    return allTaskDetails;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

/**
 * Returns the number of active Fargate tasks for an account in a given region
 * @param {AWS.ECS} ecs an instance of ECS to make the API calls from
 * @returns {Promise<float>} number of active Fargate tasks
 */
const getRegionFargatevCPUsInUse = async (ecs) => {
  console.log("Getting Fargate vCPU usage");
  const ecsListClusters = async (params) => ecs.listClusters(params).promise(); // wrap API call to be passed to a function
  try {
    const clusters = await getAllAPIData(ecsListClusters, {}, "clusterArns");

    // Spawn all api calls to describe all tasks in each cluster then wait for them to finish.
    const describeTasksPromises = [];
    clusters.forEach((cluster) => {
      describeTasksPromises.push(describeTasksInCluster(ecs, cluster));
    });

    const allTaskDetails = await getAllPromiseResults(describeTasksPromises);

    let vCPUsInUse = 0;
    allTaskDetails.forEach((item) => {
      if (["RUNNING", "PENDING", "PROVISIONING"].includes(item.lastStatus)) {
        vCPUsInUse += item.cpu / 1024;
      }
    });

    return vCPUsInUse;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

/**
 * Returns the number of vCPUs that each DLT task will use for the region
 * @param {AWS.ECS} ecs an instance of ECS to make the API calls from with the region specified
 * @returns {Promise<int>} the number of vCPUs used in each DLT task for the region
 */
const getRegionDLTvCPUsPerTask = async (ecs, taskDefinition) => {
  console.log("Getting DLT vCPUs per task for a region");
  try {
    const apiResponse = await ecs.describeTaskDefinition({ taskDefinition: taskDefinition }).promise();
    const vCPUs = parseInt(apiResponse.taskDefinition.cpu) / 1024;
    return vCPUs;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

/**
 * Returns the Fargate resource limit, vCPUs per task, and vCPU usage for the region. This function will have undefined
 * values for each of the API calls that fail.
 * @param {Object} regionConfig a DLT regional config. Should include region and taskDefinition
 * @returns {Promise<Object>} the Fargate resource limit, limit type, and usage for the given region
 */
const getRegionFargatevCPUDetails = async (regionConfig) => {
  console.log("Getting Fargate resource usage for a region");
  try {
    let ecsOptions;
    utils.getOptions(ecsOptions); // duplicate options to avoid async interleaving issues
    options.region = regionConfig.region;

    const ecs = new AWS.ECS(options);
    const servicequotas = new AWS.ServiceQuotas(options);

    // Return a null value if any of the functions fail
    const vCPUFargateLimitPromise = getRegionFargatevCPULimit(servicequotas).catch(() => undefined);
    const vCPUsPerTaskPromise = getRegionDLTvCPUsPerTask(ecs, regionConfig.taskDefinition).catch(() => undefined);
    const vCPUsInUsePromise = getRegionFargatevCPUsInUse(ecs).catch(() => undefined);

    return {
      vCPULimit: await vCPUFargateLimitPromise,
      vCPUsPerTask: await vCPUsPerTaskPromise,
      vCPUsInUse: await vCPUsInUsePromise,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

/**
 * Returns the Fargate vCPU limit, number of vCPUs per DLT task, and current
 * Fargate vCPU usage by region. Regions with errors will contain undefined values
 * @returns {Promise<Object>} the resource usage for a region
 */
const getAccountFargatevCPUDetails = async () => {
  console.log("Getting Fargate resource details for all regions");
  try {
    const regionalConfigs = await getAllRegionConfigs();

    const regionalPromises = [];
    const accountFargatevCPUDetails = {};
    for (const regionalConfig of regionalConfigs) {
      // Setup values for if a region completely fails
      accountFargatevCPUDetails[regionalConfig.region] = {
        vCPULimit: undefined,
        vCPUsPerTask: undefined,
        vCPUsInUse: undefined,
      };

      regionalPromises.push(
        getRegionFargatevCPUDetails(regionalConfig).then(
          (details) => (accountFargatevCPUDetails[regionalConfig.region] = details)
        )
      );
    }
    await Promise.allSettled(regionalPromises);

    return accountFargatevCPUDetails;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

module.exports = {
  listTests: listTests,
  createTest: createTest,
  getTest: getTest,
  deleteTest: deleteTest,
  cancelTest: cancelTest,
  listTasks: listTasks,
  scheduleTest: scheduleTest,
  getAllRegionConfigs: getAllRegionConfigs,
  getCFUrl: getCFUrl,
  getAccountFargatevCPUDetails: getAccountFargatevCPUDetails,
  getTestDurationSeconds: getTestDurationSeconds,
};
