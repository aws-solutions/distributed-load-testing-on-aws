// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { AgentCoreContext, AgentCoreEvent, ToolResponse } from "./lib/common";
import { getApiGatewayEndpoint, getRegion } from "./lib/config";
import { AppError } from "./lib/errors";
import { IAMHttpClient } from "./lib/http-client";
import { logRequestComplete, logRequestError, startRequest as logRequestStart } from "./lib/logger";
import {
  approximateTokenCount,
  sendToolUsageMetric,
  toolUsageMetricSchemaVersion,
  toolUsageMetricType,
  toolUsageUserAgent,
} from "./lib/metrics";
import {
  handleGetBaselineTestRun,
  handleGetLatestTestRun,
  handleGetScenarioDetails,
  handleGetTestRun,
  handleGetTestRunArtifacts,
  handleListScenarios,
  handleListTestRuns,
} from "./tools";

/**
 * Lambda handler for AgentCore Gateway tool invocations
 */
export const handler = async (event: AgentCoreEvent, context: AgentCoreContext): Promise<ToolResponse> => {
  const startTime = Date.now();
  let toolName = "unknown";

  try {
    // Extract tool information from AgentCore context
    const delimiter = "___"; // structure should always be gateway-target-name___tool-name
    const originalToolName = context.clientContext.custom.bedrockAgentCoreToolName;
    toolName = originalToolName.substring(originalToolName.indexOf(delimiter) + delimiter.length);

    // Initialize structured logging and log request start
    logRequestStart(context, toolName, event);

    // Initialize HTTP client with correlation ID
    const httpClient = new IAMHttpClient(getRegion(), context.awsRequestId);
    const apiEndpoint = getApiGatewayEndpoint();

    // Route to appropriate tool handler with validated parameters
    let result: any;
    switch (toolName) {
      case "list_scenarios":
        result = await handleListScenarios(httpClient, apiEndpoint, event);
        break;

      case "get_scenario_details":
        result = await handleGetScenarioDetails(httpClient, apiEndpoint, event);
        break;

      case "list_test_runs":
        result = await handleListTestRuns(httpClient, apiEndpoint, event);
        break;

      case "get_test_run":
        result = await handleGetTestRun(httpClient, apiEndpoint, event);
        break;

      case "get_latest_test_run":
        result = await handleGetLatestTestRun(httpClient, apiEndpoint, event);
        break;

      case "get_baseline_test_run":
        result = await handleGetBaselineTestRun(httpClient, apiEndpoint, event);
        break;

      case "get_test_run_artifacts":
        result = await handleGetTestRunArtifacts(httpClient, apiEndpoint, event);
        break;

      default:
        throw new AppError(`Unknown tool: ${toolName}`, 400);
    }

    const responseBody = JSON.stringify(result);
    const durationMs = Date.now() - startTime;
    const tokenCount = approximateTokenCount(responseBody);

    // Log successful completion
    logRequestComplete(toolName, durationMs, 200, tokenCount);

    // Send operational metric
    await sendToolUsageMetric({
      Type: toolUsageMetricType,
      MetricSchemaVersion: toolUsageMetricSchemaVersion,
      UserAgent: toolUsageUserAgent,
      ToolName: toolName,
      TokenCount: tokenCount,
      DurationMs: durationMs,
      Status: "success",
      StatusCode: 200,
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: responseBody,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const statusCode = error instanceof AppError ? error.code : 500;
    const message = error instanceof AppError ? error.message : "Internal server error";

    const errorResponse = { error: message };
    const errorResponseBody = JSON.stringify(errorResponse);
    const tokenCount = approximateTokenCount(errorResponseBody);

    // Log error with structured logging
    logRequestError(toolName, error as Error, durationMs, statusCode, tokenCount);

    // Send operational metric
    await sendToolUsageMetric({
      Type: toolUsageMetricType,
      MetricSchemaVersion: toolUsageMetricSchemaVersion,
      UserAgent: toolUsageUserAgent,
      ToolName: toolName,
      TokenCount: tokenCount,
      DurationMs: durationMs,
      Status: "failure",
      StatusCode: statusCode,
    });

    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
      },
      body: errorResponseBody,
    };
  }
};
