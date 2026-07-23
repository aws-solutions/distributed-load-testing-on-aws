// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { createResponse } from "./handlers/types.ts";
import { handleTasks } from "./handlers/tasks.ts";

// TODO: JS module — implicitly typed as `any` until migrated to TypeScript
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const scenarios = require("./lib/scenarios/");
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const {
  validateTestId,
  validateTestRunId,
  validateQueryForResource,
  validateBodyForResource,
} = require("./lib/validation");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

// TODO: JS handlers — implicitly typed as `any` until migrated to TypeScript.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleRegions } = require("./handlers/regions");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleScenarios, sendScenarioWriteMetric } = require("./handlers/scenarios");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleScenarioWithTestId } = require("./handlers/scenario");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleTestRuns } = require("./handlers/test-runs");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleTestRun } = require("./handlers/test-run");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleVCPUDetails } = require("./handlers/vcpu-details");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleStackInfo } = require("./handlers/stack-info");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { handleBaseline } = require("./handlers/baseline");
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const {
  handleAgentSpaces,
  handleAgentSpaceWithId,
  handleAgentSpaceTestConnection,
} = require("./handlers/agent-spaces");
const {
  handleInvestigations,
  handleInvestigationWithId,
  handleInvestigationStatus,
  handleInvestigationFindings,
} = require("./handlers/investigations");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

const validateConfig = (config: Record<string, unknown>): void => {
  const testCreateKeyDataTypes: Record<string, string> = Object.freeze({
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

  for (const key in config) {
    if (testCreateKeyDataTypes[key]) {
      // eslint-disable-next-line valid-typeof
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

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  // NOSONAR
  let data: unknown;
  let response: APIGatewayProxyResult;
  let config: Record<string, unknown> = {};

  // Parse JSON body with error handling
  if (event.body) {
    try {
      config = JSON.parse(event.body);
    } catch (_err) {
      return createResponse("Invalid JSON in request body", scenarios.StatusCodes.BAD_REQUEST);
    }
  }

  const resource = event.resource;
  const method = event.httpMethod;
  const errorMsg = new scenarios.ErrorException(
    "METHOD_NOT_ALLOWED",
    `Method: ${method} not supported for this resource: ${resource}`,
    scenarios.StatusCodes.NOT_ALLOWED
  );

  const userAgent = event.headers?.["User-Agent"] || event.headers?.["user-agent"];
  const correlationId = event.headers?.["X-Correlation-Id"] || event.headers?.["x-correlation-id"];

  if (correlationId) {
    console.log(`Request ID: ${context.awsRequestId}, Correlation ID: ${correlationId}`);
  }

  try {
    // Validate path parameters (testId, testRunId) using Zod
    if (event.pathParameters) {
      if (event.pathParameters["testId"]) {
        try {
          validateTestId(event.pathParameters["testId"]);
        } catch (validationError: unknown) {
          throw new scenarios.ErrorException(
            "INVALID_PATH_PARAMETER",
            (validationError as Error).message,
            scenarios.StatusCodes.BAD_REQUEST
          );
        }
      }
      if (event.pathParameters["testRunId"]) {
        try {
          validateTestRunId(event.pathParameters["testRunId"]);
        } catch (validationError: unknown) {
          throw new scenarios.ErrorException(
            "INVALID_PATH_PARAMETER",
            (validationError as Error).message,
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
    } catch (validationError: unknown) {
      throw new scenarios.ErrorException(
        "INVALID_QUERY_PARAMETER",
        (validationError as Error).message,
        scenarios.StatusCodes.BAD_REQUEST
      );
    }

    // Validate request body using Zod (for POST, PUT, DELETE with body)
    if (event.body && event.httpMethod !== "GET") {
      try {
        validateBodyForResource(event.resource, event.httpMethod, config);
      } catch (validationError: unknown) {
        throw new scenarios.ErrorException(
          "INVALID_REQUEST_BODY",
          (validationError as Error).message,
          scenarios.StatusCodes.BAD_REQUEST
        );
      }
    }

    // Avoids non-null assertions in the switch below to prevent explicit eslint disables
    const pathParams = event.pathParameters ?? {};

    switch (event.resource) {
      case "/regions":
        data = await handleRegions(method, resource, errorMsg, userAgent);
        break;
      case "/scenarios":
        validateConfig(config);
        data = await handleScenarios(
          method,
          resource,
          errorMsg,
          config,
          event.queryStringParameters,
          event.body,
          context.functionName,
          context.invokedFunctionArn,
          userAgent
        );
        break;
      case "/scenarios/{testId}":
        data = await handleScenarioWithTestId(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          null,
          context.functionName,
          event.queryStringParameters || {},
          userAgent
        );
        break;
      case "/scenarios/{testId}/testruns":
        data = await handleTestRuns(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          event.queryStringParameters,
          config,
          userAgent
        );
        break;
      case "/scenarios/{testId}/testruns/{testRunId}":
        data = await handleTestRun(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          pathParams["testRunId"],
          userAgent
        );
        break;
      case "/scenarios/{testId}/baseline":
        data = await handleBaseline(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          config,
          event.queryStringParameters,
          userAgent
        );
        break;
      case "/tasks":
        data = await handleTasks(method, resource, errorMsg, userAgent);
        break;
      case "/vCPUDetails":
        data = await handleVCPUDetails(method, resource, errorMsg, userAgent);
        break;
      case "/stack-info":
        data = await handleStackInfo(method, resource, errorMsg, userAgent);
        break;
      case "/scenarios/{testId}/testruns/{testRunId}/investigations": {
        const result = await handleInvestigations(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          pathParams["testRunId"],
          config,
          correlationId,
          event.requestContext?.identity?.cognitoIdentityId
        );
        if (result.statusCode) {
          return createResponse(result.data, result.statusCode);
        }
        data = result.data;
        break;
      }
      case "/scenarios/{testId}/testruns/{testRunId}/investigations/{investigationId}": {
        const result = await handleInvestigationWithId(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          pathParams["testRunId"],
          pathParams["investigationId"],
          config,
          correlationId,
          event.requestContext?.identity?.cognitoIdentityId
        );
        data = result.data;
        break;
      }
      case "/scenarios/{testId}/testruns/{testRunId}/investigations/{investigationId}/status": {
        const result = await handleInvestigationStatus(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          pathParams["testRunId"],
          pathParams["investigationId"],
          correlationId,
          event.requestContext?.identity?.cognitoIdentityId
        );
        data = result.data;
        break;
      }
      case "/scenarios/{testId}/testruns/{testRunId}/investigations/{investigationId}/findings": {
        const result = await handleInvestigationFindings(
          method,
          resource,
          errorMsg,
          pathParams["testId"],
          pathParams["testRunId"],
          pathParams["investigationId"],
          event.queryStringParameters?.type || "investigation",
          event.queryStringParameters?.format || "markdown",
          correlationId,
          event.requestContext?.identity?.cognitoIdentityId
        );
        data = result.data;
        break;
      }
      case "/agent-spaces":
        data = await handleAgentSpaces(method, resource, errorMsg, config, userAgent);
        break;
      case "/agent-spaces/{id}":
        data = await handleAgentSpaceWithId(method, resource, errorMsg, pathParams["id"], config, userAgent);
        break;
      case "/agent-spaces/test-connection":
        data = await handleAgentSpaceTestConnection(method, resource, errorMsg, config, userAgent, correlationId);
        break;
      default:
        throw errorMsg;
    }

    response = createResponse(data, 200);
  } catch (err: unknown) {
    console.error(err);
    const error = err as { toString(): string; statusCode?: number; retryAfter?: number };
    response = createResponse(error.toString(), error.statusCode || scenarios.StatusCodes.BAD_REQUEST);
    if (error.retryAfter) {
      response.headers = { ...response.headers, "Retry-After": String(error.retryAfter) };
    }
  }

  return response;
};

export { validateConfig, sendScenarioWriteMetric };
