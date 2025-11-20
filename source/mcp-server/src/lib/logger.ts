// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from "@aws-lambda-powertools/logger";
import type { AgentCoreContext } from "./common.js";
import { getVersion } from "./config.js";

/**
 * Centralized logger instance for the MCP server
 * Configured with structured logging and correlation ID support
 */
export const logger = new Logger({
  serviceName: "dlt-mcp-server",
  logLevel: "INFO",
  persistentKeys: {
    version: getVersion(),
  },
});

/**
 * Initialize logger and log request start
 * This should be called at the start of each Lambda invocation
 */
export function startRequest(context: AgentCoreContext, toolName: string, event: unknown): void {
  // Clear existing keys
  logger.resetKeys();

  // Add Lambda context information
  logger.addContext(context);

  // Set correlation ID from AWS request ID
  logger.appendKeys({
    correlation_id: context.awsRequestId,
    tool_name: toolName,
  });

  // Log request start
  logger.info("Processing tool request", {
    tool_name: toolName,
    event_keys: Object.keys(event as Record<string, unknown>),
  });
}

/**
 * Log request completion with metrics
 */
export function logRequestComplete(
  toolName: string,
  durationMs: number,
  statusCode: number,
  tokenCount?: number
): void {
  logger.info("Tool request completed", {
    tool_name: toolName,
    duration_ms: durationMs,
    status: "success",
    status_code: statusCode,
    token_count: tokenCount,
  });
}

/**
 * Log request failure with error details
 */
export function logRequestError(
  toolName: string,
  error: Error,
  durationMs: number,
  statusCode: number,
  tokenCount?: number
): void {
  logger.error("Tool request failed", {
    tool_name: toolName,
    duration_ms: durationMs,
    status_code: statusCode,
    token_count: tokenCount,
    status: "failure",
    error: {
      name: error.name,
      message: error.message,
    },
  });
}
