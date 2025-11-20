// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("./lib/scenarios/");
const utils = require("solution-utils");
const {
  validateTestId,
  validateTestRunId,
  validateQueryForResource,
  validateBodyForResource,
} = require("./lib/validation");

/**
 * API Manager Class that gets API path and their method
 * and calls the appropriate handler function to handle the request
 */
class APIHandler {
  constructor(resource, method) {
    this.resource = resource;
    this.method = method;
    this.errorMsg = new scenarios.ErrorException(
      "METHOD_NOT_ALLOWED",
      `Method: ${method} not supported for this resource: ${resource}`,
      scenarios.StatusCodes.NOT_ALLOWED
    );
  }

  async getRegions() {
    let data = { regions: await scenarios.getAllRegionConfigs() };
    data.url = await scenarios.getCFUrl();
    return data;
  }

  // Handle the /regions endpoint
  async handleRegions(userAgent) {
    if (this.method === "GET") {
      try {
        await utils.sendMetric({
          Type: "GetRegions",
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return this.getRegions();
    }
    throw this.errorMsg;
  }

  // Helper method to prepare task count metrics
  prepareTaskCountMetrics(config) {
    let taskCountObj = {};
    for (const taskConfig of config.testTaskConfigs) {
      taskCountObj[taskConfig.region] = taskConfig.taskCount;
    }
    return taskCountObj;
  }

  // Handle the /scenarios endpoint
  async handleScenarios(config, queryParams, body, functionName, functionArn, userAgent) {
    let data;
    switch (this.method) {
      case "GET": {
        if (queryParams && queryParams.op === "listRegions") return this.getRegions();

        // Handle tag filtering
        const filterTags =
          queryParams && queryParams.tags ? queryParams.tags.split(",").map((tag) => tag.trim()) : null;

        return await scenarios.listTests(filterTags);
      }
      case "POST": {
        if (config.scheduleStep) {
          // Handle scheduling test
          data = await scenarios.scheduleTest(
            {
              resource: this.resource,
              httpMethod: this.method,
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

        try {
          await utils.sendMetric({
            Type: "TestCreate",
            TestType: config.testType,
            FileType: config.fileType || (config.testType === "simple" ? "none" : "script"),
            TaskCountPerRegion: this.prepareTaskCountMetrics(config),
            TestId: data.testId,
            TestScheduleStep: config.scheduleStep,
            HoldFor: config.testScenario?.execution?.[0]?.["hold-for"],
            RampUp: config.testScenario?.execution?.[0]?.["ramp-up"],
            CronValue: config.cronValue,
            TestEventBridgeScheduled: config.eventBridge,
            UserAgent: userAgent,
          });
        } catch (err) {
          console.error("Failed to send metric:", err);
        }
        return data;
      }
      default:
        throw this.errorMsg;
    }
  }

  // Handle the /scenarios/{testId} endpoint
  async handleScenarioWithTestId(testId, config, functionName, queryParams, userAgent) {
    switch (this.method) {
      case "GET":
        try {
          await utils.sendMetric({
            Type: "GetScenario",
            TestId: testId,
            UserAgent: userAgent,
          });
        } catch (err) {
          console.error("Failed to send metric:", err);
        }
        return scenarios.getTest(testId, queryParams);
      case "POST":
        try {
          await utils.sendMetric({
            Type: "CancelTest",
            TestId: testId,
            UserAgent: userAgent,
          });
        } catch (err) {
          console.error("Failed to send metric:", err);
        }
        return scenarios.cancelTest(testId);
      case "DELETE":
        try {
          await utils.sendMetric({
            Type: "DeleteTest",
            TestId: testId,
            UserAgent: userAgent,
          });
        } catch (err) {
          console.error("Failed to send metric:", err);
        }
        return scenarios.deleteTest(testId, functionName);
      default:
        throw this.errorMsg;
    }
  }

  // Handle the /scenarios/{testId}/testruns endpoint
  async handleTestRuns(testId, queryParams, body, userAgent) {
    if (this.method === "GET") {
      try {
        await utils.sendMetric({
          Type: "GetTestRuns",
          TestId: testId,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.getTestRuns(testId, queryParams);
    }
    if (this.method === "DELETE") {
      try {
        await utils.sendMetric({
          Type: "DeleteTestRuns",
          TestId: testId,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.deleteTestRuns(testId, body);
    }
    throw this.errorMsg;
  }

  // Handle the /scenarios/{testId}/testruns/{testRunId} endpoint
  async handleTestRun(testId, testRunId, userAgent) {
    if (this.method === "GET") {
      try {
        await utils.sendMetric({
          Type: "GetTestRun",
          TestId: testId,
          TestRunId: testRunId,
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.getTestRun(testId, testRunId);
    }
    throw this.errorMsg;
  }

  // Handle the /tasks endpoint
  async handleTasks(userAgent) {
    if (this.method === "GET") {
      try {
        await utils.sendMetric({
          Type: "GetTasks",
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.listTasks();
    }
    throw this.errorMsg;
  }

  // Handle the /vCPUDetails endpoint
  async handleVCPUDetails(userAgent) {
    if (this.method === "GET") {
      try {
        await utils.sendMetric({
          Type: "GetVCPUDetails",
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.getAccountFargatevCPUDetails();
    }
    throw this.errorMsg;
  }

  // Handle the /stack-info endpoint
  async handleStackInfo(userAgent) {
    if (this.method === "GET") {
      try {
        await utils.sendMetric({
          Type: "GetStackInfo",
          UserAgent: userAgent,
        });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return scenarios.getStackInfo();
    }
    throw this.errorMsg;
  }

  // Handle the /scenarios/{testId}/baseline endpoint
  async handleBaseline(testId, config, queryParams, userAgent) {
    switch (this.method) {
      case "GET": {
        // GET /scenarios/{testId}/baseline[?data=false] - data is true by default
        const includeData = !queryParams || queryParams.data !== "false";
        try {
          await utils.sendMetric({
            Type: "GetBaseline",
            TestId: testId,
            UserAgent: userAgent,
          });
        } catch (err) {
          console.error("Failed to send metric:", err);
        }
        return scenarios.getBaseline(testId, includeData);
      }
      case "PUT":
        try {
          await utils.sendMetric({
            Type: "SetBaseline",
            TestId: testId,
            TestRunId: config.testRunId,
            UserAgent: userAgent,
          });
        } catch (err) {
          console.error("Failed to send metric:", err);
        }
        return scenarios.setBaseline(testId, config.testRunId);
      case "DELETE":
        try {
          await utils.sendMetric({
            Type: "ClearBaseline",
            TestId: testId,
            UserAgent: userAgent,
          });
        } catch (err) {
          console.error("Failed to send metric:", err);
        }
        return scenarios.clearBaseline(testId);
      default:
        throw this.errorMsg;
    }
  }
}

// Helper function to handle API response
const createResponse = (data, statusCode) => ({
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
  },
  statusCode: statusCode,
  body: JSON.stringify(data),
});

//validate config object for data types for inputs.
const validateConfig = (config) => {
  const testCreateKeyDataTypes = Object.freeze({
    testId: "string",
    testName: "string",
    testDescription: "string",
    testTaskConfigs: "object",
    testScenario: "object",
    showLive: "boolean",
    testType: "string",
    fileType: "string",
    regionalTaskDetails: "object",
    tags: "object",
  });

  for (let key in config) {
    if (testCreateKeyDataTypes[key]) {
      if (typeof config[key] !== testCreateKeyDataTypes[key]) {
        throw new scenarios.ErrorException(
          "BAD_INPUT",
          `Invalid input type for ${key}`,
          scenarios.StatusCodes.BAD_REQUEST
        );
      }
    }
  }
};

// Main handler function
exports.handler = async (event, context) => { // NOSONAR
  let data;
  let response;
  let config = {};
  
  // Parse JSON body with error handling
  if (event.body) {
    try {
      config = JSON.parse(event.body);
    } catch (err) {
      return createResponse("Invalid JSON in request body", scenarios.StatusCodes.BAD_REQUEST);
    }
  }
  
  const apiHandler = new APIHandler(event.resource, event.httpMethod);

  const userAgent = event.headers?.["User-Agent"] || event.headers?.["user-agent"];
  const correlationId = event.headers?.["X-Correlation-Id"] || event.headers?.["x-correlation-id"];

  if (correlationId) {
    console.log(`Request ID: ${context.awsRequestId}, Correlation ID: ${correlationId}`);
  }

  try {
    // Validate path parameters (testId, testRunId) using Zod
    if (event.pathParameters) {
      if (event.pathParameters.testId) {
        try {
          validateTestId(event.pathParameters.testId);
        } catch (validationError) {
          throw new scenarios.ErrorException(
            "INVALID_PATH_PARAMETER",
            validationError.message,
            scenarios.StatusCodes.BAD_REQUEST
          );
        }
      }
      if (event.pathParameters.testRunId) {
        try {
          validateTestRunId(event.pathParameters.testRunId);
        } catch (validationError) {
          throw new scenarios.ErrorException(
            "INVALID_PATH_PARAMETER",
            validationError.message,
            scenarios.StatusCodes.BAD_REQUEST
          );
        }
      }
    } else if (event.resource.includes("{testId}")) {
      // Path parameters are required for these resources
      throw new scenarios.ErrorException(
        "INVALID_PATH_PARAMETER",
        "Path parameters are required for this resource",
        scenarios.StatusCodes.BAD_REQUEST
      );
    }

    // Validate query parameters using Zod
    try {
      validateQueryForResource(event.resource, event.queryStringParameters);
    } catch (validationError) {
      throw new scenarios.ErrorException(
        "INVALID_QUERY_PARAMETER",
        validationError.message,
        scenarios.StatusCodes.BAD_REQUEST
      );
    }

    // Validate request body using Zod (for POST, PUT, DELETE with body)
    if (event.body && event.httpMethod !== "GET") {
      try {
        validateBodyForResource(event.resource, event.httpMethod, config);
      } catch (validationError) {
        throw new scenarios.ErrorException(
          "INVALID_REQUEST_BODY",
          validationError.message,
          scenarios.StatusCodes.BAD_REQUEST
        );
      }
    }

    switch (event.resource) {
      case "/regions":
        data = await apiHandler.handleRegions(userAgent);
        break;
      case "/scenarios":
        // EventBridge invocations have no headers or httpMethod, API Gateway requests always have httpMethod
        if (!event.headers && !event.httpMethod && config) config.eventBridge = "true";
        validateConfig(config);
        data = await apiHandler.handleScenarios(
          config,
          event.queryStringParameters,
          event.body,
          context.functionName,
          context.invokedFunctionArn,
          userAgent
        );

        break;
      case "/scenarios/{testId}":
        data = await apiHandler.handleScenarioWithTestId(
          event.pathParameters.testId,
          null,
          context.functionName,
          event.queryStringParameters || {},
          userAgent
        );
        break;
      case "/scenarios/{testId}/testruns":
        data = await apiHandler.handleTestRuns(
          event.pathParameters.testId,
          event.queryStringParameters,
          config,
          userAgent
        );
        break;
      case "/scenarios/{testId}/testruns/{testRunId}":
        data = await apiHandler.handleTestRun(event.pathParameters.testId, event.pathParameters.testRunId, userAgent);
        break;
      case "/scenarios/{testId}/baseline":
        data = await apiHandler.handleBaseline(
          event.pathParameters.testId,
          config,
          event.queryStringParameters,
          userAgent
        );
        break;
      case "/tasks":
        data = await apiHandler.handleTasks(userAgent);
        break;
      case "/vCPUDetails":
        data = await apiHandler.handleVCPUDetails(userAgent);
        break;
      case "/stack-info":
        data = await apiHandler.handleStackInfo(userAgent);
        break;
      default:
        throw apiHandler.errorMsg;
    }

    response = createResponse(data, 200);
  } catch (err) {
    console.error(err);
    response = createResponse(err.toString(), err.statusCode || scenarios.StatusCodes.BAD_REQUEST);
  }

  console.log(response);
  return response;
};

exports.validateConfig = validateConfig;
