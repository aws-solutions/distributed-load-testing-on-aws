// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { CloudFormation } = require("@aws-sdk/client-cloudformation");
const { CloudWatch } = require("@aws-sdk/client-cloudwatch");
const { CloudWatchEvents } = require("@aws-sdk/client-cloudwatch-events");
const { CloudWatchLogs } = require("@aws-sdk/client-cloudwatch-logs");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { ECS } = require("@aws-sdk/client-ecs");
const { Lambda } = require("@aws-sdk/client-lambda");
const { S3 } = require("@aws-sdk/client-s3");
const { ServiceQuotas } = require("@aws-sdk/client-service-quotas");
const { SFN } = require("@aws-sdk/client-sfn");

const utils = require("solution-utils");
const cronParser = require("cron-parser");

const {
  HISTORY_TABLE,
  HISTORY_TABLE_GSI_NAME,
  SCENARIOS_TABLE,
  SCENARIOS_BUCKET,
  STATE_MACHINE_ARN,
  TASK_CANCELER_ARN,
  STACK_ID,
  STACK_NAME,
} = process.env;

let options = utils.getOptions({ region: process.env.AWS_REGION });
const s3 = new S3(options);
const lambda = new Lambda(options);
const dynamoDB = DynamoDBDocument.from(new DynamoDB(options));
const stepFunctions = new SFN(options);
const cloudwatchevents = new CloudWatchEvents(options);
const cloudformation = new CloudFormation(options);

const StatusCodes = {
  OK: 200,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ALLOWED: 405,
  REQUEST_TOO_LONG: 413,
  INTERNAL_SERVER_ERROR: 500,
  TIMEOUT: 503,
};

/**
 * Class to throw errors
 * @param {string} code
 * @param {string} errMsg
 */
class ErrorException extends Error {
  constructor(code, errMsg, statusCode = StatusCodes.BAD_REQUEST) {
    super(errMsg);
    this.code = code;
    this.message = errMsg;
    this.statusCode = statusCode;
  }

  toString() {
    return `${this.code}: ${this.message}`;
  }
}

/**
 * Normalizes a tag by converting to lowercase, replacing spaces with hyphens,
 * removing special characters, and cleaning up multiple hyphens
 * @param {string} tag - The tag to normalize
 * @returns {string} - The normalized tag
 */
const normalizeTag = (tag) => {
  if (tag == null) return String(tag);
  return tag
    .toString()
    .trim() // Remove leading/trailing whitespace
    .toLowerCase() // Convert to lowercase
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, "") // Remove special characters except hyphens
    .replace(/-+/g, "-") // Replace multiple consecutive hyphens with single
    .replace(/^-/, "") // Remove leading hyphens
    .replace(/-$/, ""); // Remove trailing hyphens
};

/**
 * Validates and normalizes an array of tags
 * @param {Array} tags - Array of tags to validate
 * @returns {Array} - Array of validated and normalized tags
 * @throws {ErrorException} - If validation fails
 */
const validateTags = (tags) => {
  if (!tags) return [];

  if (!Array.isArray(tags)) {
    throw new ErrorException("InvalidParameter", "Tags must be an array");
  }

  if (tags.length > 5) {
    throw new ErrorException("InvalidParameter", "Maximum 5 tags allowed per scenario");
  }

  // Normalize and clean tags
  const normalizedTags = tags
    .map((tag) => normalizeTag(tag))
    .filter((tag) => tag.length > 0 && tag.length <= 50);

  // Remove duplicates (case-insensitive since we normalized to lowercase)
  const uniqueTags = [...new Set(normalizedTags)];

  // Validate final tag format
  const tagRegex = /^[a-z0-9-]+$/;
  const invalidTags = uniqueTags.filter((tag) => !tagRegex.test(tag));
  if (invalidTags.length > 0) {
    throw new ErrorException("InvalidParameter", `Invalid tag format: ${invalidTags.join(", ")}`);
  }

  return uniqueTags;
};

/**
 * Get URL for the regional CloudFormation template from the main CloudFormation stack exports
 * @returns {string} The S3 URL for the modified regional CloudFormation template
 */
const getCFUrl = async () => {
  let exports = [];
  let params = {};
  try {
    do {
      const listExports = await cloudformation.listExports(params);
      exports.push(...listExports.Exports);
      params.NextToken = listExports.NextToken;
    } while (params.NextToken);
    const result = exports.find((entry) => entry.ExportingStackId === STACK_ID && entry.Name === `${STACK_NAME || ''}-RegionalCFTemplate`);
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
      const regionConfigs = await dynamoDB.scan(params);
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
    const response = await dynamoDB.get(params);
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
    const ddbEntry = await dynamoDB.get(regionalParameters);
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
    if (!testEntry) throw new ErrorException("TEST_NOT_FOUND", `testId '${testId}' not found`, StatusCodes.NOT_FOUND);
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
      const historyEntries = await dynamoDB.query(params);
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
 * Creates a list of all test scenarios sorted by startTime descending
 * @returns {object} All created tests sorted by creation time
 */
const listTests = async (filterTags = null) => {
  console.log("List tests");

  try {
    let response = [];
    const params = {
      TableName: SCENARIOS_TABLE,
      ProjectionExpression:
        "testId, testName, testDescription, #status, startTime, nextRun, scheduleRecurrence, cronValue, tags",
      ExpressionAttributeNames: {
        "#status": "status", // "status" is a reserved word in DynamoDB
      },
    };

    // Add tag filtering if filterTags are provided
    if (filterTags && filterTags.length > 0) {
      // Normalize filter tags using the same logic as tag validation
      const normalizedFilterTags = filterTags.map((tag) => normalizeTag(tag)).filter((tag) => tag.length > 0);

      if (normalizedFilterTags.length > 0) {
        // Use FilterExpression for tag filtering (OR logic)
        const filterExpressions = normalizedFilterTags.map((_, index) => `contains(tags, :tag${index})`);
        params.FilterExpression = `(${filterExpressions.join(" OR ")}) AND (NOT contains(testId, :regionStr))`;
        params.ExpressionAttributeValues = {
          ":regionStr": "region",
        };
        normalizedFilterTags.forEach((tag, index) => {
          params.ExpressionAttributeValues[`:tag${index}`] = tag;
        });
      }
    } else {
      // No tag filtering - just exclude region entries
      params.FilterExpression = "NOT contains(testId, :regionStr)";
      params.ExpressionAttributeValues = {
        ":regionStr": "region",
      };
    }

    do {
      const result = await dynamoDB.scan(params);
      // Ensure tags field exists for all items (backward compatibility)
      const itemsWithTags = result.Items.map((item) => ({
        ...item,
        tags: item.tags || [],
      }));
      response.push(...itemsWithTags);
      params.ExclusiveStartKey = result.LastEvaluatedKey;
    } while (params.ExclusiveStartKey);

    response.sort((a, b) => {
      const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
      const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
      return bTime - aTime;
    });

    for (const scenario of response) {
      try {
        scenario.totalTestRuns = await getTotalCount(scenario.testId);
      } catch (err) {
        console.error(`Error getting test run count for testId ${scenario.testId}:`, err);
        scenario.totalTestRuns = 0;
      }
    }

    return { Items: response };
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Convert Linux cron expression to AWS cron expression
 * @param {string} linux cron input
 * @returns An equivalent string in AWS cron format
 */
const convertLinuxCronToAwsCron = (linuxCron, cronExpiryDate) => {
  const parts = linuxCron.trim().split(" ");

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  let awsDayOfMonth = dayOfMonth;
  let awsDayOfWeek = dayOfWeek;

  // Adjust the day of the week and day of the month
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    awsDayOfWeek = "?";
  } else if (dayOfMonth !== "*" && dayOfWeek === "*") {
    awsDayOfWeek = "?";
  } else if (dayOfMonth === "*" && dayOfWeek !== "*") {
    awsDayOfMonth = "?";
  } else if (dayOfMonth !== "*" && dayOfWeek !== "*") {
    awsDayOfWeek = "?";
  }

  // Handle ranges and steps in the day_of_week field
  awsDayOfWeek = awsDayOfWeek.replace(/\b[0-7]\b/g, (match) => {
    if (match === "0" || match === "7") {
      return "1";
    } else {
      return (parseInt(match) + 1).toString();
    }
  });

  let cronYear = new Date().getFullYear();
  if (cronExpiryDate && cronYear < new Date(cronExpiryDate).getFullYear()) {
    const cronExpiryYear = new Date(cronExpiryDate).getFullYear();
    cronYear = `${cronYear}-${cronExpiryYear}`;
  }

  return `${minute} ${hour} ${awsDayOfMonth} ${month} ${awsDayOfWeek} ${cronYear}`;
};

const checkEnoughIntervalDiff = (cronValue, cronExpiryDate, holdFor, rampUp, testTaskConfigs) => {
  if (!holdFor || !rampUp) return "";
  let cronExpiry = new Date(cronExpiryDate);
  const parts = cronValue.trim().split(" ");
  if (parts.length !== 5) throw new ErrorException("Invalid Linux cron expression", "Expected format: 0 * * * *");

  let cronInterval;
  try {
    cronInterval = cronParser.parseExpression(cronValue, { utc: true });
  } catch (err) {
    throw new ErrorException("Invalid Linux cron expression", "Expected format: 0 * * * *");
  }

  let fields = JSON.parse(JSON.stringify(cronInterval.fields));
  let totalTaskCount = 0;
  for (const testTaskConfig of testTaskConfigs) totalTaskCount += testTaskConfig.taskCount;
  let estimatedTestDuration = 2 * Math.floor(Math.ceil(totalTaskCount / 10) * 1.5 + 600);
  estimatedTestDuration += getTestDurationSeconds(holdFor);
  estimatedTestDuration += getTestDurationSeconds(rampUp);
  let prev = cronInterval.next();
  let next = cronInterval.next();

  let prevDate = new Date(prev);
  let nextDate = new Date(next);

  // Only one run exist
  if (nextDate > cronExpiry) return null;

  // Making sure only one integer in the minute field
  // and diff of two tests are at least one hour
  if (fields.minute.length !== 1) {
    throw new ErrorException("Invalid Parameter", "The interval between scheduled tests cannot be less than an hour.");
  }

  while (next && prev) {
    prevDate = new Date(prev);
    nextDate = new Date(next);
    if (nextDate - prevDate < estimatedTestDuration * 1000)
      throw new ErrorException(
        "Invalid Parameter",
        "The interval between scheduled tests is too short. Please ensure there is enough time between test runs to accommodate the duration of each test."
      );

    if (prevDate > cronExpiry) {
      break;
    }
    prev = next;
    next = cronInterval.next();
  }
};

/**
 * Parsing cron value next run
 * @param {string} linux cron input
 * @returns A map of nextRunDate object and its string value.
 */
const cronNextRun = (cronValue, cronExpiryDate = "", scheduleStep = "") => {
  const parts = cronValue.trim().split(" ");
  if (parts.length !== 5) throw new ErrorException("Invalid Linux cron expression", "Expected format: 0 * * * *");

  let cronInterval;
  try {
    cronInterval = cronParser.parseExpression(cronValue, { utc: true });
  } catch (err) {
    throw new ErrorException("Invalid Linux cron expression", "Expected format: 0 * * * *");
  }

  const initRun = cronInterval.next().toString();
  const nextRunDate = new Date(initRun);
  if (cronExpiryDate && new Date(cronExpiryDate) < nextRunDate) {
    if (scheduleStep) {
      throw new ErrorException("Invalid Parameter", "Cron Expiry Date older than the next run.");
    }
    return { nextRunDate: "", nextRun: "" };
  }

  const year = nextRunDate.getUTCFullYear();
  const month = String(nextRunDate.getUTCMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const day = String(nextRunDate.getUTCDate()).padStart(2, "0");
  const hour = String(nextRunDate.getUTCHours()).padStart(2, "0");
  const minute = String(nextRunDate.getUTCMinutes()).padStart(2, "0");
  const time = `${hour}:${minute}:00`;
  const date = `${year}-${month}-${day}`;
  const nextRun = `${date} ${time}`;
  return { nextRunDate: nextRunDate, nextRun: nextRun };
};

const getScheduleString = (props) => {
  const { recurrence, cronValue, minute, hour, day, month, year, cronExpiryDate } = props;
  if (recurrence && !cronValue) {
    switch (recurrence) {
      case "daily":
        return "rate(1 day)";
      case "weekly":
        return "rate(7 days)";
      case "biweekly":
        return "rate(14 days)";
      case "monthly":
        return `cron(${minute} ${hour} ${day} * ? *)`;
      default:
        throw new ErrorException("InvalidParameter", "Invalid recurrence value.");
    }
  } else if (cronValue) {
    const scheduleString = `cron(${convertLinuxCronToAwsCron(cronValue, cronExpiryDate)})`;
    console.log(`scheduleString: ${scheduleString}`);
    return scheduleString;
  } else {
    const scheduleString = `cron(${minute} ${hour} ${day} ${month} ? ${year})`;
    console.log(`scheduleString: ${scheduleString}`);
    return scheduleString;
  }
};

/**
 * remove eventbirdge rules and targets
 * @param {object} testId
 * @param {object} lambda function name that is the target
 * @param {object} recurrence
 * @returns
 */
const removeRules = async (testId, functionName, recurrence) => {
  if (recurrence) {
    let ruleName = `${testId}Create`;
    await cloudwatchevents.removeTargets({ Rule: ruleName, Ids: [ruleName] });
    await lambda.removePermission({ FunctionName: functionName, StatementId: ruleName });
    await cloudwatchevents.deleteRule({ Name: ruleName });
  }
};

const isValidTimeString = (timeString) => {
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(timeString))
    throw new ErrorException("InvalidParameter", "Invalid time format. Expected format: HH:MM");
};

const isValidDateString = (dateString) => {
  // Check if the dateString is in the format YYYY-MM-DD
  const dateRegex = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  if (!dateRegex.test(dateString))
    throw new ErrorException("InvalidParameter", "Invalid date format. Expected format: YYYY-MM-DD");
};

const isValidDate = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (date < today) throw new ErrorException("InvalidParameter", "Date cannot be in the past");
};
/**
 * Schedules test and returns a consolidated list of test scenarios
 * @param {object} event test event information
 * @param {object} context the lambda context information
 * @returns A map of attribute values in Dynamodb after scheduled.
 */
const scheduleTest = async (event, context) => { // NOSONAR
  console.log("Scheduling Test::");
  try {
    let config = JSON.parse(event.body);
    let {
      testId,
      scheduleDate,
      scheduleTime,
      showLive,
      cronValue,
      cronExpiryDate,
      recurrence,
      testScenario,
      testTaskConfigs,
      regionalTaskDetails,
    } = config;
    cronExpiryDate = cronExpiryDate ? cronExpiryDate : "";
    let hour, minute, year, month, day;
    if (scheduleTime && scheduleDate) {
      [hour, minute] = scheduleTime.split(":");
      [year, month, day] = scheduleDate.split("-");
    }
    let nextRun = scheduleTime && scheduleDate ? `${year}-${month}-${day} ${hour}:${minute}:00` : "";
    const functionName = context.functionName;
    const functionArn = context.functionArn;
    let scheduleRecurrence = recurrence ? recurrence : "";
    if (!cronValue && !scheduleDate && !scheduleTime)
      throw new ErrorException(
        "InvalidParameter",
        "Missing cronValue, scheduleDate and ScheduleTime. Cannot schedule the Test."
      );
    // check if rule exists, delete rule if exists
    let rulesResponse = await cloudwatchevents.listRules({ NamePrefix: testId });

    for (let rule of rulesResponse.Rules) {
      let ruleName = rule.Name;
      await cloudwatchevents.removeTargets({ Rule: ruleName, Ids: [ruleName] });
      await lambda.removePermission({ FunctionName: functionName, StatementId: ruleName });
      await cloudwatchevents.deleteRule({ Name: ruleName });
    }

    let createRun;
    if (config.scheduleStep === "create") {
      testTaskConfigs = validateTaskCountConcurrency(testTaskConfigs, regionalTaskDetails);
      if (cronValue) {
        checkEnoughIntervalDiff(
          cronValue,
          cronExpiryDate,
          testScenario.execution[0]["hold-for"],
          testScenario.execution[0]["ramp-up"],
          testTaskConfigs
        );

        const cronNextRunObj = cronNextRun(cronValue, cronExpiryDate, config.scheduleStep);
        createRun = cronNextRunObj.nextRunDate;
        nextRun = cronNextRunObj.nextRun;
        [scheduleDate, scheduleTime] = nextRun.split(" ");
        config.scheduleTime = scheduleTime;
        config.scheduleDate = scheduleDate;
      } else {
        isValidTimeString(scheduleTime);
        isValidDateString(scheduleDate);
        createRun = new Date(year, parseInt(month, 10) - 1, day, hour, minute);
        isValidDate(createRun);
      } // Schedule for 1 min prior to account for time it takes to create rule
      // getMonth() returns Jan with index Zero that is why months need a +1
      // refrence https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getMonth
      createRun.setMinutes(createRun.getMinutes() - 1);
      const cronStart = `cron(${createRun.getMinutes()} ${createRun.getHours()} ${createRun.getDate()} ${
        createRun.getMonth() + 1
      } ? ${createRun.getFullYear()})`;

      //Create rule to create schedule
      const createRuleParams = {
        Name: `${testId}Create`,
        Description: `Create test schedule for: ${testId}`,
        ScheduleExpression: cronStart,
        State: "ENABLED",
      };
      let ruleArn = await cloudwatchevents.putRule(createRuleParams);

      //Add permissions to lambda
      let permissionParams = {
        Action: "lambda:InvokeFunction",
        FunctionName: functionName,
        Principal: "events.amazonaws.com",
        SourceArn: ruleArn.RuleArn,
        StatementId: `${testId}Create`,
      };
      await lambda.addPermission(permissionParams);

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
      await cloudwatchevents.putTargets(createTargetParams);
    } else {
      //create schedule expression
      const getScheduleStringProps = { recurrence, cronValue, minute, hour, day, month, year, cronExpiryDate };
      let scheduleString = getScheduleString(getScheduleStringProps);

      //Create rule to run on schedule
      const ruleParams = {
        Name: `${testId}Scheduled`,
        Description: `Scheduled tests for ${testId}`,
        ScheduleExpression: scheduleString,
        State: "ENABLED",
      };
      let ruleArn = await cloudwatchevents.putRule(ruleParams);

      //Add permissions to lambda
      let permissionParams = {
        Action: "lambda:InvokeFunction",
        FunctionName: functionName,
        Principal: "events.amazonaws.com",
        SourceArn: ruleArn.RuleArn,
        StatementId: `${testId}Scheduled`,
      };
      await lambda.addPermission(permissionParams);

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
      await cloudwatchevents.putTargets(targetParams);

      // Remove rule created during create schedule step
      await removeRules(testId, functionName, recurrence);
    }

    //Update DynamoDB if table was not already updated by "create" schedule step
    if (config.scheduleStep || !recurrence) {
      // Validate and normalize tags
      const validatedTags = validateTags(config.tags);
      
      const updateDBData = {
        testId,
        testName: config.testName,
        testDescription: config.testDescription,
        testTaskConfigs: config.testTaskConfigs,
        testScenario: testScenario,
        status: "scheduled",
        startTime: "",
        nextRun,
        scheduleRecurrence,
        showLive,
        testType: config.testType,
        fileType: config.fileType,
        cronValue,
        cronExpiryDate,
        tags: validatedTags,
      };
      let data = await updateTestDBEntry(updateDBData);
      console.log(`Schedule test complete: testId=${testId}, status=scheduled`);

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
const setNextRun = (scheduledTime, scheduleRecurrence = "", cronValue = "", cronExpiryDate = "") => {
  if (cronValue) {
    const nextRunObj = cronNextRun(cronValue, cronExpiryDate);
    return nextRunObj.nextRun;
  }
  if (!scheduleRecurrence) return "";

  let newDate = new Date(scheduledTime.getTime());

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
      return s3.putObject(params);
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
    const testRunId = utils.generateUniqueId(10);
    const timestamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, "")
      .replace(/:/g, "-");
    const prefix = timestamp + "_" + testRunId;
    await stepFunctions.startExecution({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({
        ...stepFunctionParams,
        prefix,
        testRunId,
      }),
    });
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
      status,
      startTime,
      nextRun,
      scheduleRecurrence,
      showLive,
      testType,
      fileType,
      cronExpiryDate,
      tags,
    } = updateTestConfigs;

    let cronValue = updateTestConfigs.cronValue || "";
    let endTime = status == "running" ? "running" : "";
    const params = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: testId,
      },
      UpdateExpression:
        "set #n = :n, #d = :d, #tc = :tc, #t = :t, #s = :s, #r = :r, #st = :st, #et = :et, #nr = :nr, #sr = :sr, #sl = :sl, #tt = :tt, #ft = :ft, #cv = :cv, #ced = :ced, #tg = :tg",
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
        "#cv": "cronValue",
        "#ced": "cronExpiryDate",
        "#tg": "tags",
      },
      ExpressionAttributeValues: {
        ":n": testName,
        ":d": testDescription,
        ":tc": testTaskConfigs,
        ":t": JSON.stringify(testScenario),
        ":s": status,
        ":r": {},
        ":st": startTime,
        ":et": endTime,
        ":nr": nextRun,
        ":sr": scheduleRecurrence,
        ":sl": showLive,
        ":tt": testType,
        ":ft": fileType,
        ":cv": cronValue,
        ":ced": cronExpiryDate,
        ":tg": tags || [],
      },
      ReturnValues: "ALL_NEW",
    };
    return await dynamoDB.update(params);
  } catch (err) {
    console.error(`Error updating test entry for testId=${updateTestConfigs.testId}: ${err.message}, Code: ${err.code || 'N/A'}`);
    // Sanitize DynamoDB-specific errors that expose internal implementation details
    if (err.message && (
      err.message.includes('Number.MAX_SAFE_INTEGER') ||
      err.message.includes('@aws-sdk/lib-dynamodb')
    )) {
      throw new ErrorException("InvalidParameter", "Invalid parameter value provided", StatusCodes.BAD_REQUEST);
    }
    throw new ErrorException("InternalError", "Failed to update test configuration", StatusCodes.INTERNAL_SERVER_ERROR);
  }
};

/**
 * @function convertDateToString
 * Description: Formats the date to a YYYY-MM-DD HH:MM:SS format
 * @config {string} a formatted string date
 *  */
const convertDateToString = (date) => {
  // Validate date to prevent RangeError with invalid Date objects
  if (!date || isNaN(date.getTime())) {
    throw new ErrorException("InvalidParameter", "Invalid date provided for conversion");
  }
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
};

/**
 * Description: handle eventbridge scheduled test start time
 * @param {string} cronValue
 * @param {string} scheduleTime
 @returns {Date} startTime
 *  */
const getEbSchedTestStartTime = (cronValue, scheduleTime, cronExpiryDate) => {
  if (!cronValue) {
    const startDate = new Date().toISOString().slice(0, 10);
    return new Date(`${startDate} ${scheduleTime}:00`);
  }
  const cronExpiry = new Date(cronExpiryDate);
  let cronInterval = cronParser.parseExpression(cronValue, { utc: true });
  const startTime = new Date(cronInterval.prev().toString());
  if (startTime > cronExpiry) return "Cron Expiry Reached";

  return startTime;
};

/**
 * @function createTest
 * Description: returns a consolidated list of test scenarios
 * @config {object} test scenario configuration
 */
const createTest = async (config, functionName) => {
  console.log("Create test: ");
  try {
    const { testName, testDescription, testType, showLive, regionalTaskDetails, cronValue } = config;
    let { testId, testScenario, testTaskConfigs, fileType, scheduleTime, eventBridge, recurrence, cronExpiryDate } =
      config;
    cronExpiryDate = cronExpiryDate ? cronExpiryDate : "";
    let nextRun;
    fileType = setFileType(testType, fileType);
    testId = setTestId(testId);

    // Validate and normalize tags
    const validatedTags = validateTags(config.tags);

    const testEntry = await getTestEntry(testId);
    if (testEntry && testEntry.nextRun) nextRun = new Date(testEntry.nextRun);

    let startTime = new Date();

    if (eventBridge) startTime = getEbSchedTestStartTime(cronValue, scheduleTime, cronExpiryDate);
    if (startTime == "Cron Expiry Reached") {
      console.log("Cron Expiry Reached");
      await deleteRules(testId, functionName);
      return null;
    }

    if (nextRun && startTime < nextRun) nextRun = convertDateToString(nextRun);
    else nextRun = setNextRun(startTime, recurrence, cronValue, cronExpiryDate);

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

    console.log(`Test scenario created: testId=${testId}, type=${testType}, regions=${testTaskConfigs?.length}`);

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

    // Update DynamoDB values
    const updateDBData = {
      testId,
      testName,
      testDescription,
      testTaskConfigs,
      testScenario,
      status: "running",
      startTime,
      nextRun,
      scheduleRecurrence,
      showLive,
      testType,
      fileType,
      cronValue,
      cronExpiryDate,
      tags: validatedTags,
    };

    const data = await updateTestDBEntry(updateDBData);

    console.log(`Create test complete: testId=${testId}, status=${data.Attributes?.status}`);

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
    describeTasksResponse = await ecs.describeTasks(params);
    
    // Select relevant subset of task data
    const taskData = describeTasksResponse.tasks.map(task => ({
      taskArn: task.taskArn,
      lastStatus: task.lastStatus,
      desiredStatus: task.desiredStatus,
      startedAt: task.startedAt,
      cpu: task.cpu,
      memory: task.memory,
      containers: task.containers?.map(container => ({
        name: container.name,
        lastStatus: container.lastStatus,
        exitCode: container.exitCode
      })) || []
    }));
    
    tasksInRegion.tasks = tasksInRegion.tasks.concat(taskData);
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
    tasksResponse = await ecs.listTasks(params);
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
  // Process all regions in parallel using Promise.all for better performance
  const regionalPromises = data.testTaskConfigs.map(async (testRegion) => {
    if (!testRegion.taskCluster) {
      const errorMessage = new ErrorException(
        "InvalidInfrastructureConfiguration",
        `There is no ECS test infrastructure configured for region ${testRegion.region}`
      );
      console.log(errorMessage);
      throw errorMessage;
    }

    const region = testRegion.region;
    let tasksInRegion = { region: region, tasks: [] };
    
    // Create region-specific options to avoid race conditions
    const regionalOptions = { ...options, region: region };
    const ecs = new ECS(regionalOptions);
    
    const tasks = await getListOfTasksInRegion(ecs, testRegion.taskCluster, testId);
    if (tasks.length !== 0) {
      tasksInRegion = await getRunningTasks(ecs, tasks, testRegion.taskCluster, tasksInRegion);
    }
    
    return tasksInRegion;
  });

  // Wait for all regional task fetches to complete in parallel
  data.tasksPerRegion = await Promise.all(regionalPromises);
  return data;
};

/**
 * @function getTest
 * Description: returns all data related to a specific testId
 * @testId {string} the unique id of test scenario to return.
 * @queryParams {object} query parameters to control what data is included
 */
const getTest = async (testId, queryParams = {}) => {
  console.log(`Get test details for testId: ${testId}`);

  try {
    //Retrieve test and regional resource information from DDB
    let data = await getTestAndRegionConfigs(testId);

    data.testScenario = JSON.parse(data.testScenario);

    // Ensure tags field exists for backward compatibility
    data.tags = data.tags || [];

    // Add total test runs count
    try {
      data.totalTestRuns = await getTotalCount(testId);
    } catch (err) {
      console.error(`Error getting test run count for testId ${testId}:`, err);
      data.totalTestRuns = 0;
    }

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

    // Handle history parameter - include history unless explicitly set to false
    const includeHistory = queryParams.history !== "false";
    if (includeHistory) {
      data.history = await getTestHistoryEntries(testId);
    } else {
      data.history = []; // Empty array when history=false
    }

    // Handle latest parameter - exclude results if latest=false
    const includeResults = queryParams.latest !== "false";
    if (!includeResults) {
      data.results = {}; // Empty object when latest=false
    }
    // Note: results are already set in the existing data when latest=true or missing

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
    await dynamoDB.delete(params);
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
      const testRunIds = await dynamoDB.query(params);
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
    const response = await dynamoDB.batchWrite(params);
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
  const cloudwatchLogs = new CloudWatchLogs(options);
  const cloudwatch = new CloudWatch(options);

  for (let metric of metrics) {
    console.log("deleting metric filter:", `${taskCluster}-Ecs${metric}-${testId}`);
    let deleteMetricFilterParams = {
      filterName: `${taskCluster}-Ecs${metric}-${testId}`,
      logGroupName: ecsCloudWatchLogGroup,
    };
    try {
      await cloudwatchLogs.deleteMetricFilter(deleteMetricFilterParams);
    } catch (e) {
      if (e.name === "ResourceNotFoundException") {
        console.error("metric filter", `${taskCluster}-Ecs${metric}-${testId}`, "does not exist");
      } else {
        throw e;
      }
    }
  }
  
  // Publish updated metric filter count
  try {
    let metricFilters = [];
    let params = { logGroupName: ecsCloudWatchLogGroup };
    let response;
    do {
      response = await cloudwatchLogs.describeMetricFilters(params);
      metricFilters = metricFilters.concat(response.metricFilters);
      params.nextToken = response.nextToken;
    } while (response.nextToken);
    
    await cloudwatch.putMetricData({
      Namespace: 'distributed-load-testing',
      MetricData: [{
        MetricName: 'MetricFilterCount',
        Value: metricFilters.length,
        Dimensions: [{ Name: 'LogGroupName', Value: ecsCloudWatchLogGroup }]
      }]
    });
    console.log(`Published metric filter count: ${metricFilters.length} for log group: ${ecsCloudWatchLogGroup}`);
  } catch (error) {
    console.warn('Failed to publish metric filter count:', error.message);
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
      const cloudwatch = new CloudWatch(options);
      await deleteMetricFilter(testId, regionConfig.taskCluster, regionConfig.ecsCloudWatchLogGroup);
      //Delete Dashboard
      console.log("deleting dash:", dashboardNames);
      const deleteDashboardParams = { DashboardNames: dashboardNames };
      await cloudwatch.deleteDashboards(deleteDashboardParams);
    }
  } catch (err) {
    console.error(err);
    throw err;
  }
};

const deleteRules = async (testId, functionName) => {
  try {
    //Get Rules
    let rulesResponse = await cloudwatchevents.listRules({ NamePrefix: testId });
    //Delete Rule
    for (let rule of rulesResponse.Rules) {
      let ruleName = rule.Name;
      await cloudwatchevents.removeTargets({ Rule: ruleName, Ids: [ruleName] });
      await lambda.removePermission({ FunctionName: functionName, StatementId: ruleName });
      await cloudwatchevents.deleteRule({ Name: ruleName });
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
    await deleteRules(testId, functionName);
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
    const listTestsRes = await listTests();
    const allTests = listTestsRes.Items;

    // Check if the testId exists in the list of tests
    const testExists = allTests.some((test) => test.testId === testId);
    if (!testExists) {
      throw new ErrorException("TEST_NOT_FOUND", `testId '${testId}' not found`, StatusCodes.NOT_FOUND);
    }

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
        await lambda.invoke(taskCancelerParams);
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
    await dynamoDB.update(params);

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
      const ecs = new ECS(options);
      const taskArns = [];
      do {
        let data = await ecs.listTasks(params);
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
 * Grabs users Fargate vCPU limit for the region specified by the ServiceQuota parameter
 * @param {ServiceQuotas} servicequotas an instance of ServiceQuotas with the proper region to make the API calls from
 * @returns {Promise<int>} the number of vCPUs allowed for a given region
 */
const getRegionFargatevCPULimit = async (servicequotas) => {
  console.log("Getting the users Fargate vCPU limit from ServiceQuotas");
  try {
    const sqParams = { ServiceCode: "fargate", QuotaCode: "L-3032A538" };
    const sqData = await servicequotas.getServiceQuota(sqParams);

    return sqData.Quota.Value;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Returns the descriptions of all Fargate tasks within a cluster
 * @param {ECS} ecs an instance of ECS to make the API calls from
 * @param {string} clusterArn the cluster in question
 * @returns {Promise<array>} array of descriptions for the Fargate tasks
 */
const describeTasksInCluster = async (ecs, clusterArn) => {
  console.log("Describing all the Fargate tasks within a cluster");
  const ecsListTasks = async (params) => ecs.listTasks(params); // wrap API call to be passed to a function
  const API_REQUEST_LIMIT = 100; // AWS API calls can only request 100

  try {
    const tasks = await getAllAPIData(ecsListTasks, { cluster: clusterArn, launchType: "FARGATE" }, "taskArns");

    const taskDetailPromises = [];
    splitArrayBySize(tasks, API_REQUEST_LIMIT).forEach((taskArray) => {
      const describeTaskPromise = ecs
        .describeTasks({ cluster: clusterArn, tasks: taskArray })
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
 * @param {ECS} ecs an instance of ECS to make the API calls from
 * @returns {Promise<float>} number of active Fargate tasks
 */
const getRegionFargatevCPUsInUse = async (ecs) => {
  console.log("Getting Fargate vCPU usage");
  const ecsListClusters = async (params) => ecs.listClusters(params); // wrap API call to be passed to a function
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
 * @param {ECS} ecs an instance of ECS to make the API calls from with the region specified
 * @returns {Promise<int>} the number of vCPUs used in each DLT task for the region
 */
const getRegionDLTvCPUsPerTask = async (ecs, taskDefinition) => {
  console.log("Getting DLT vCPUs per task for a region");
  try {
    const apiResponse = await ecs.describeTaskDefinition({ taskDefinition: taskDefinition });
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

    const ecs = new ECS(options);
    const servicequotas = new ServiceQuotas(options);

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

/**
 * Parse float values from various formats (DynamoDB, string, number)
 * @param {any} val - The value to parse
 * @returns {number|undefined} Parsed float value or undefined
 */
const parseFloatValue = (val) => {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val);
  return val && val.S ? parseFloat(val.S) : undefined;
};

/**
 * Parse integer values from various formats (DynamoDB, string, number)
 * @param {any} val - The value to parse
 * @returns {number|undefined} Parsed integer value or undefined
 */
const parseIntValue = (val) => {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseInt(val);
  return val && val.N ? parseInt(val.N) : undefined;
};

/**
 * Extract and parse the total results object from various input formats
 * @param {object|string} results - The results object or JSON string
 * @returns {object|null} Parsed total object or null if invalid
 */
const extractTotalResults = (results) => {
  if (!results) return null;

  if (typeof results === "string") {
    try {
      return JSON.parse(results).total;
    } catch (e) {
      return null;
    }
  }

  return results.total;
};

/**
 * Build percentiles object from total results
 * @param {object} total - The total results object
 * @returns {object} Percentiles with converted millisecond values
 */
const buildPercentiles = (total) => {
  const convertToMs = (val) => {
    const parsed = parseFloatValue(val);
    return parsed ? parsed * 1000 : undefined;
  };

  return {
    p0: convertToMs(total.p0_0),
    p50: convertToMs(total.p50_0),
    p90: convertToMs(total.p90_0),
    p95: convertToMs(total.p95_0),
    p99: convertToMs(total.p99_0),
    p99_9: convertToMs(total.p99_9),
    p100: convertToMs(total.p100_0),
  };
};

/**
 * Calculate derived metrics from base values
 * @param {object} total - The total results object
 * @param {number} testDuration - Test duration in seconds
 * @returns {object} Object with derived metrics
 */
const calculateDerivedMetrics = (total, testDuration) => {
  const throughput = parseIntValue(total.throughput);
  const bytes = parseIntValue(total.bytes);
  const avgRt = parseFloatValue(total.avg_rt);
  const avgLt = parseFloatValue(total.avg_lt);
  const avgCt = parseFloatValue(total.avg_ct);

  return {
    requestsPerSecond: throughput ? throughput / testDuration : undefined,
    avgResponseTime: avgRt ? avgRt * 1000 : undefined,
    avgLatency: avgLt ? avgLt * 1000 : undefined,
    avgConnectionTime: avgCt ? avgCt * 1000 : undefined,
    avgBandwidth: bytes ? bytes / testDuration : undefined,
  };
};

/**
 * Extract metrics from DynamoDB results structure
 * @param {object} results - The results object from DynamoDB
 * @returns {object} Extracted metrics
 */
const extractMetrics = (results) => {
  const total = extractTotalResults(results);
  if (!total) return {};

  const testDuration = parseIntValue(total.testDuration) || 1;
  const derivedMetrics = calculateDerivedMetrics(total, testDuration);

  return {
    requests: parseIntValue(total.throughput),
    success: parseIntValue(total.succ),
    errors: parseIntValue(total.fail),
    ...derivedMetrics,
    percentiles: buildPercentiles(total),
  };
};

/**
 * Helper function to create base query parameters for history table
 * @param {string} testId - The test ID
 * @param {object} options - Additional options (limit, select, etc.)
 * @returns {object} Base DynamoDB query parameters
 */
const createHistoryQueryParams = (testId, options = {}) => {
  const params = {
    TableName: HISTORY_TABLE,
    IndexName: HISTORY_TABLE_GSI_NAME,
    KeyConditionExpression: "#t = :t",
    ExpressionAttributeNames: { "#t": "testId" },
    ExpressionAttributeValues: { ":t": testId },
    ...options,
  };
  return params;
};

/**
 * Helper function to add timestamp conditions to DynamoDB query parameters
 * @param {object} params - DynamoDB query parameters
 * @param {string} start_timestamp - Start timestamp filter
 * @param {string} end_timestamp - End timestamp filter
 */
const addTimestampConditions = (params, start_timestamp, end_timestamp) => {
  if (start_timestamp && end_timestamp) {
    params.KeyConditionExpression += " AND #st BETWEEN :start AND :end";
    params.ExpressionAttributeNames["#st"] = "startTime";
    params.ExpressionAttributeValues[":start"] = convertDateToString(new Date(start_timestamp));
    params.ExpressionAttributeValues[":end"] = convertDateToString(new Date(end_timestamp));
  } else if (start_timestamp) {
    params.KeyConditionExpression += " AND #st >= :start";
    params.ExpressionAttributeNames["#st"] = "startTime";
    params.ExpressionAttributeValues[":start"] = convertDateToString(new Date(start_timestamp));
  } else if (end_timestamp) {
    params.KeyConditionExpression += " AND #st <= :end";
    params.ExpressionAttributeNames["#st"] = "startTime";
    params.ExpressionAttributeValues[":end"] = convertDateToString(new Date(end_timestamp));
  }
};

/**
 * Validate query parameters for getTestRuns function
 * @param {object} queryParams - Query parameters to validate
 * @returns {object} Validated and parsed parameters
 */
const validateTestRunsQueryParams = (queryParams) => {
  const { limit = 20, start_timestamp, end_timestamp, latest, next_token } = queryParams;

  // Validate timestamp formats if provided
  if (start_timestamp && isNaN(Date.parse(start_timestamp))) {
    throw new ErrorException(
      "BAD_REQUEST",
      "Invalid start_timestamp format. Expected ISO 8601",
      StatusCodes.BAD_REQUEST
    );
  }
  if (end_timestamp && isNaN(Date.parse(end_timestamp))) {
    throw new ErrorException("BAD_REQUEST", "Invalid end_timestamp format. Expected ISO 8601", StatusCodes.BAD_REQUEST);
  }

  // Validate limit parameter
  const parsedLimit = parseInt(limit);
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    throw new ErrorException("BAD_REQUEST", "Limit must be between 1 and 100", StatusCodes.BAD_REQUEST);
  }

  return { parsedLimit, start_timestamp, end_timestamp, latest, next_token };
};

/**
 * Handle pagination token for DynamoDB queries
 * @param {object} params - DynamoDB query parameters
 * @param {string} next_token - Base64 encoded pagination token
 */
const applyPaginationToken = (params, next_token) => {
  if (!next_token) return;

  try {
    const decodedToken = Buffer.from(next_token, "base64").toString();
    params.ExclusiveStartKey = JSON.parse(decodedToken);
  } catch (error) {
    throw new ErrorException("BAD_REQUEST", "Invalid next_token format", StatusCodes.BAD_REQUEST);
  }
};

/**
 * Transform DynamoDB items to test run response format
 * @param {Array} items - DynamoDB items
 * @returns {Array} Formatted test run objects
 */
const formatTestRunItems = (items) =>
  items
    ? items.map((item) => ({
        testRunId: item.testRunId,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status || "complete",
        ...extractMetrics(item.results),
      }))
    : [];

/**
 * Handle the latest test run query (special case for latest=true)
 * @param {string} testId - The test scenario ID
 * @returns {object} Response object with latest test run
 */
const getLatestTestRun = async (testId) => {
  const params = createHistoryQueryParams(testId, { ScanIndexForward: false, Limit: 1 });
  const testRuns = await dynamoDB.query(params);

  return {
    testRuns: formatTestRunItems(testRuns.Items),
    pagination: { limit: 1, next_token: null, total_count: 1 },
  };
};

/**
 * Get total count for filtered results
 * @param {string} testId - The test scenario ID
 * @param {string} start_timestamp - Start timestamp filter
 * @param {string} end_timestamp - End timestamp filter
 * @returns {number} Total count of filtered results
 */
const getTotalCount = async (testId, start_timestamp, end_timestamp) => {
  const countParams = createHistoryQueryParams(testId, { Select: "COUNT" });
  addTimestampConditions(countParams, start_timestamp, end_timestamp);
  const countResult = await dynamoDB.query(countParams);
  return countResult.Count;
};

/**
 * Retrieve test runs for a specific test scenario with optional filtering
 * @param {string} testId - The test scenario ID
 * @param {object} queryParams - Query parameters for filtering
 * @returns {object} List of test runs with pagination and optional filtering
 */
const getTestRuns = async (testId, queryParams = {}) => {
  console.log(`Get test runs for testId: ${testId}`);

  try {
    // Validate testId exists
    const testEntry = await getTestEntry(testId);
    if (!testEntry) {
      throw new ErrorException("TEST_NOT_FOUND", `testId '${testId}' not found`, StatusCodes.NOT_FOUND);
    }

    // Validate and parse query parameters
    const { parsedLimit, start_timestamp, end_timestamp, latest, next_token } =
      validateTestRunsQueryParams(queryParams);

    // Handle latest query as special case
    if (latest === "true") {
      return await getLatestTestRun(testId);
    }

    // Get total count for pagination (skip for latest queries)
    const totalCount = await getTotalCount(testId, start_timestamp, end_timestamp);

    // Build main query parameters
    const params = createHistoryQueryParams(testId, { ScanIndexForward: false, Limit: parsedLimit });
    addTimestampConditions(params, start_timestamp, end_timestamp);
    applyPaginationToken(params, next_token);

    // Execute query
    const testRuns = await dynamoDB.query(params);

    return {
      testRuns: formatTestRunItems(testRuns.Items),
      pagination: {
        limit: parsedLimit,
        next_token: testRuns.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(testRuns.LastEvaluatedKey)).toString("base64")
          : null,
        total_count: totalCount,
      },
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Retrieves a specific test run from the history table
 * @param {string} testId - ID of the test scenario
 * @param {string} testRunId - ID of the specific test run
 * @returns {Promise<object>} The DynamoDB response containing the test run data
 */
const getTestRun = async (testId, testRunId) => {
  console.log(`Getting testRunId ${testRunId} for testId ${testId}`);

  // Validate required parameters
  if (!testId || typeof testId !== "string" || testId.length > 128) {
    throw new ErrorException("INVALID_PARAMETER", "testId is required", StatusCodes.BAD_REQUEST);
  }

  if (!testRunId || typeof testRunId !== "string" || testRunId.length > 128) {
    throw new ErrorException("INVALID_PARAMETER", "testRunId is required", StatusCodes.BAD_REQUEST);
  }

  try {
    const params = {
      TableName: HISTORY_TABLE,
      Key: {
        testId: testId,
        testRunId: testRunId,
      },
    };

    const response = await dynamoDB.get(params);

    if (!response.Item) {
      throw new ErrorException(
        "TESTRUN_NOT_FOUND",
        `Test run '${testRunId}' not found for test '${testId}'`,
        StatusCodes.NOT_FOUND
      );
    }

    console.log(`Successfully retrieved test run ${testRunId} for test ${testId}`);
    return response.Item;
  } catch (err) {
    console.error(`Error retrieving test run ${testRunId} for test ${testId}:`, err);

    // Re-throw ErrorException instances (our custom errors)
    if (err instanceof ErrorException) {
      throw err;
    }

    // Handle DynamoDB and other unexpected errors
    throw new ErrorException(
      "INTERNAL_SERVER_ERROR",
      `Failed to retrieve test run: ${err.message}`,
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }
};

/**
 * Get stack information including creation time, region, and version
 * @returns {object} Stack information with created_time, region, and version
 */
const getStackInfo = async () => {
  console.log("Getting stack information");
  try {
    if (!STACK_ID) {
      throw new ErrorException("STACK_NOT_FOUND", "Stack ID not available", StatusCodes.NOT_FOUND);
    }

    const response = await cloudformation.describeStacks({ StackName: STACK_ID });

    if (!response.Stacks || response.Stacks.length === 0) {
      throw new ErrorException("STACK_NOT_FOUND", "Stack not found", StatusCodes.NOT_FOUND);
    }

    const stack = response.Stacks[0];

    // Try to get version from tags first, then from description
    let version = stack.Tags?.find((tag) => tag.Key === "SolutionVersion")?.Value;

    if (!version && stack.Description) {
      const versionMatch = stack.Description.match(/v\d+\.\d+\.\d+/);
      version = versionMatch ? versionMatch[0] : "unknown";
    }

    // Find the McpEndpoint output from the outputs array
    const mcpEndpointOutput = stack.Outputs?.find(output => output.OutputKey === 'McpEndpoint');
    const mcpEndpoint = mcpEndpointOutput?.OutputValue;

    return {
      created_time: stack.CreationTime.toISOString(),
      region: stack.StackId.split(":")[3],
      version: version || "unknown",
      mcp_endpoint: mcpEndpoint,
    };
  } catch (err) {
    console.error(err);
    if (err.statusCode) {
      throw err;
    }
    if (err.name === "AccessDenied" || err.name === "UnauthorizedOperation") {
      throw new ErrorException(
        "FORBIDDEN",
        "Insufficient permissions to access stack information",
        StatusCodes.FORBIDDEN
      );
    }
    throw new ErrorException(
      "INTERNAL_SERVER_ERROR",
      "Failed to retrieve stack information",
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }
};

/**
 * Sets a test run as the baseline for a scenario
 * @param {string} testId the unique id of test scenario
 * @param {string} testRunId the test run id to set as baseline
 * @returns Success message with baseline details
 */
const setBaseline = async (testId, testRunId) => {
  console.log(`Set baseline for testId: ${testId}, testRunId: ${testRunId}`);

  try {
    if (!testRunId) {
      throw new ErrorException("INVALID_PARAMETER", "testRunId is required", StatusCodes.BAD_REQUEST);
    }

    // First, validate that the test scenario exists
    const testEntry = await getTestEntry(testId);
    if (!testEntry) {
      throw new ErrorException("TEST_NOT_FOUND", `testId '${testId}' not found`, StatusCodes.NOT_FOUND);
    }

    // Validate that the testRunId exists in the history table
    const historyParams = {
      TableName: HISTORY_TABLE,
      Key: {
        testId: testId,
        testRunId: testRunId,
      },
    };

    const historyEntry = await dynamoDB.get(historyParams);
    if (!historyEntry.Item) {
      throw new ErrorException(
        "TESTRUN_NOT_FOUND",
        `testRunId '${testRunId}' not found for test '${testId}'`,
        StatusCodes.NOT_FOUND
      );
    }

    // Get current baseline if exists
    const currentBaseline = testEntry.baselineId;

    // Update the scenarios table with the new baseline
    const updateParams = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: testId,
      },
      UpdateExpression: "set baselineId = :baselineId",
      ExpressionAttributeValues: {
        ":baselineId": testRunId,
      },
      ReturnValues: "ALL_NEW",
    };

    await dynamoDB.update(updateParams);

    // Prepare response message
    const response = {
      testId: testId,
      baselineId: testRunId,
    };

    if (currentBaseline) {
      response.message = "Baseline updated successfully";
      response.previousBaselineId = currentBaseline;
      response.details = `Test run ${testRunId} is now the baseline for test ${testId}, replacing previous baseline ${currentBaseline}`;
    } else {
      response.message = "Baseline set successfully";
      response.details = `Test run ${testRunId} is now the baseline for test ${testId}`;
    }

    console.log(`Set baseline complete: testId=${testId}, baselineId=${testRunId}`);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Clears the baseline for a scenario
 * @param {string} testId the unique id of test scenario
 * @returns Success message
 */
const clearBaseline = async (testId) => {
  console.log(`Clear baseline for testId: ${testId}`);

  try {
    // First, validate that the test scenario exists
    const testEntry = await getTestEntry(testId);
    if (!testEntry) {
      throw new ErrorException("TEST_NOT_FOUND", `testId '${testId}' not found`, StatusCodes.NOT_FOUND);
    }

    // Check if baseline exists
    if (!testEntry.baselineId) {
      throw new ErrorException(
        "NO_BASELINE_SET",
        `No baseline is currently set for test '${testId}'`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Remove the baseline from the scenarios table
    const updateParams = {
      TableName: SCENARIOS_TABLE,
      Key: {
        testId: testId,
      },
      UpdateExpression: "remove baselineId",
      ReturnValues: "ALL_NEW",
    };

    await dynamoDB.update(updateParams);

    const response = {
      message: "Baseline cleared successfully",
      testId: testId,
      details: `Baseline removed for test ${testId}`,
    };

    console.log(`Clear baseline complete: testId=${testId}`);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Deletes specific test runs for a given test scenario
 * @param {string} testId the unique id of test scenario
 * @param {Array} testRunIds array of test run IDs to delete
 * @returns Object with count of deleted test runs
 */
const deleteTestRuns = async (testId, testRunIds) => {
  console.log(`Delete test runs for testId: ${testId}`);

  try {
    // Validate that testId exists
    const testEntry = await getTestEntry(testId);
    if (!testEntry) {
      throw new ErrorException("TEST_NOT_FOUND", `testId '${testId}' not found`, StatusCodes.NOT_FOUND);
    }

    // Validate input
    if (!Array.isArray(testRunIds)) {
      throw new ErrorException("BAD_REQUEST", "Request body must be an array of testRunIds", StatusCodes.BAD_REQUEST);
    }

    if (testRunIds.length === 0) {
      return { deletedCount: 0 };
    }

    // Validate each testRunId exists before attempting deletion
    const existingTestRunIds = [];
    for (const testRunId of testRunIds) {
      if (typeof testRunId !== "string") {
        continue; // Skip non-string testRunIds silently
      }

      try {
        const historyParams = {
          TableName: HISTORY_TABLE,
          Key: {
            testId: testId,
            testRunId: testRunId,
          },
        };
        const historyEntry = await dynamoDB.get(historyParams);
        if (historyEntry.Item) {
          existingTestRunIds.push(testRunId);
        }
      } catch (error) {
        // Skip testRunIds that cause errors (e.g., invalid format)
        console.warn(`Skipping testRunId ${testRunId}: ${error.message}`);
        continue;
      }
    }

    if (existingTestRunIds.length === 0) {
      return { deletedCount: 0 };
    }

    // Use existing batch delete functionality
    const testRuns = createBatchRequestItems(testId, existingTestRunIds);
    await parseBatchRequests(testRuns);

    console.log(`Successfully deleted ${existingTestRunIds.length} test runs for testId: ${testId}`);
    return { deletedCount: existingTestRunIds.length };
  } catch (err) {
    console.error(err);
    throw err;
  }
};

/**
 * Gets the baseline for a scenario
 * @param {string} testId the unique id of test scenario
 * @param {boolean} includeResults whether to include test run details
 * @returns Baseline information with optional test run details
 */
const getBaseline = async (testId, includeResults = false) => {
  console.log(`Get baseline for testId: ${testId}, includeResults: ${includeResults}`);

  try {
    // First, validate that the test scenario exists
    const testEntry = await getTestEntry(testId);
    if (!testEntry) {
      throw new ErrorException("TEST_NOT_FOUND", `testId '${testId}' not found`, StatusCodes.NOT_FOUND);
    }

    // Check if baseline is set
    if (!testEntry.baselineId) {
      const response = {
        testId: testId,
        baselineId: null,
        message: "No baseline set for this test",
      };

      console.log(`Get baseline complete (no baseline): testId=${testId}`);
      return response;
    }

    // Prepare base response
    const response = {
      testId: testId,
      baselineId: testEntry.baselineId,
      message: "Baseline retrieved successfully",
    };

    // If results are requested, fetch the baseline test run details
    if (includeResults) {
      const historyParams = {
        TableName: HISTORY_TABLE,
        Key: {
          testId: testId,
          testRunId: testEntry.baselineId,
        },
      };

      const historyEntry = await dynamoDB.get(historyParams);
      if (historyEntry.Item) {
        response.testRunDetails = {
          testRunId: historyEntry.Item.testRunId,
          startTime: historyEntry.Item.startTime,
          endTime: historyEntry.Item.endTime,
          status: historyEntry.Item.status,
          results: historyEntry.Item.results,
        };
      } else {
        // Baseline test run not found in history (orphaned baseline)
        console.warn(`Baseline test run ${testEntry.baselineId} not found in history for test ${testId}`);
        response.testRunDetails = null;
        response.warning = "Baseline test run details not found - may have been deleted";
      }
    }

    console.log(`Get baseline complete: testId=${testId}, baselineId=${testEntry.baselineId}`);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

module.exports = {
  listTests: listTests,
  createTest: createTest,
  getTest: getTest,
  getTestEntry: getTestEntry,
  deleteTest: deleteTest,
  cancelTest: cancelTest,
  listTasks: listTasks,
  scheduleTest: scheduleTest,
  getAllRegionConfigs: getAllRegionConfigs,
  getCFUrl: getCFUrl,
  getAccountFargatevCPUDetails: getAccountFargatevCPUDetails,
  getStackInfo: getStackInfo,
  getTestDurationSeconds: getTestDurationSeconds,
  getTestRuns: getTestRuns,
  deleteTestRuns: deleteTestRuns,
  getTestRun: getTestRun,
  extractMetrics: extractMetrics,
  setBaseline: setBaseline,
  clearBaseline: clearBaseline,
  getBaseline: getBaseline,
  normalizeTag: normalizeTag,
  ErrorException: ErrorException,
  StatusCodes: StatusCodes,
};
