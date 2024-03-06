// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require("./lib/scenarios/");
const utils = require("solution-utils");
/**
 * API Manager Class that gets API path and their method
 * and calls the appropriate handler function to handle the request
 */
class APIHandler {
  constructor(resource, method) {
    this.resource = resource;
    this.method = method;
    this.errorMsg = `Method: ${method} not supported for this resource: ${resource} `;
  }
  async getRegions() {
    let data = { regions: await scenarios.getAllRegionConfigs() };
    data.url = await scenarios.getCFUrl();
    return data;
  }
  // Handle the /regions endpoint
  async handleRegions() {
    if (this.method === "GET") return this.getRegions();
    throw new Error(this.errorMsg);
  }

  // Handle the /scenarios endpoint
  async handleScenarios(config, queryParams, body, functionName, functionArn) {
    let data;
    switch (this.method) {
      case "GET":
        if (queryParams && queryParams.op === "listRegions") return this.getRegions();
        data = await scenarios.listTests();
        return data;
      case "POST":
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
        // Handle creating test
        else data = await scenarios.createTest(config);
        if (process.env.SEND_METRIC === "Yes") {
          await utils.sendMetric({
            Type: "TaskCreate",
            TestType: config.testType,
            FileType: config.fileType || (config.testType === "simple" ? "none" : "script"),
            TaskCount: config.taskCount,
          });
        }
        return data;
      default:
        throw new Error(this.errorMsg);
    }
  }

  // Handle the /scenarios/{testId} endpoint
  async handleScenarioWithTestId(testId, functionName) {
    switch (this.method) {
      case "GET":
        return scenarios.getTest(testId);
      case "POST":
        return scenarios.cancelTest(testId);
      case "DELETE":
        return scenarios.deleteTest(testId, functionName);
      default:
        throw new Error(this.errorMsg);
    }
  }

  // Handle the /tasks endpoint
  async handleTasks() {
    if (this.method === "GET") return scenarios.listTasks();
    throw new Error(this.errorMsg);
  }

  // Handle the /vCPUDetails endpoint
  async handleVCPUDetails() {
    if (this.method === "GET") return scenarios.getAccountFargatevCPUDetails();
    throw new Error(this.errMsg);
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

// Main handler function
exports.handler = async (event, context) => {
  console.log(JSON.stringify(event, null, 2));
  let data;
  let response;
  let config = JSON.parse(event.body);
  const apiHandler = new APIHandler(event.resource, event.httpMethod);

  try {
    switch (event.resource) {
      case "/regions":
        data = await apiHandler.handleRegions();
        break;
      case "/scenarios":
        if (!event.headers) config.eventBridge = "true";

        data = await apiHandler.handleScenarios(
          config,
          event.queryStringParameters,
          event.body,
          context.functionName,
          context.invokedFunctionArn
        );

        break;
      case "/scenarios/{testId}":
        data = await apiHandler.handleScenarioWithTestId(event.pathParameters.testId, context.functionName);
        break;
      case "/tasks":
        data = await apiHandler.handleTasks();
        break;
      case "/vCPUDetails":
        data = await apiHandler.handleVCPUDetails();
        break;
      default:
        throw new Error(apiHandler.errorMsg);
    }

    response = createResponse(data, 200);
  } catch (err) {
    console.error(err);
    response = createResponse(err.toString(), 400);
  }

  console.log(response);
  return response;
};
