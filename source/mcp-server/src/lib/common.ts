// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Event objects will include tool parameters and are specific to the tool being invoked.
 * Each tool will perform its own validation.
 */
export interface AgentCoreEvent {
  [key: string]: unknown;
}

/**
 * AgentCore Gateway context object.
 * This should be replaced by a well-maintained library like @types/aws-lambda once available.
 */
export interface AgentCoreContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionVersion: string;
  functionName: string;
  memoryLimitInMB: string;
  logGroupName: string;
  logStreamName: string;
  clientContext: {
    custom: {
      bedrockAgentCoreTargetId: string;
      bedrockAgentCoreGatewayId: string;
      bedrockAgentCoreMessageVersion: string;
      bedrockAgentCoreMcpMessageId: string;
      bedrockAgentCoreAwsRequestId: string;
      bedrockAgentCoreToolName: string;
    };
  };
  invokedFunctionArn: string;
  awsRequestId: string;
}

/**
 * Response object returned by Lambda handler.
 */
export interface ToolResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

/**
 * Allow alphanumeric characters and dashes
 */
export const TEST_SCENARIO_ID_REGEX = /^[A-Za-z0-9-]+$/;

/**
 * Allow alphanumeric characters and dashes
 */
export const TEST_RUN_ID_REGEX = /^[A-Za-z0-9-]+$/;

/**
 * Test ID length
 */
export const TEST_SCENARIO_ID_LENGTH = 10;

/**
 * Test Run ID length
 */
export const TEST_RUN_ID_LENGTH = 10;

/**
 * Helper function to safely parse and validate event parameters using Zod schema
 * Converts ZodError to AppError with proper 400 status code
 */
export function parseEventWithSchema<T>(schema: z.ZodSchema<T>, event: AgentCoreEvent): T {
  try {
    return schema.parse(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues.map((issue: z.core.$ZodIssue) => 
        `${issue.path.join('.')}: ${issue.message}`
      ).join('; ');
      throw new AppError(`Validation failed: ${errorMessages}`, 400);
    }
    throw error; // generic Error objects will be converted to 500 Internal Service Error in Lambda handler
  }
}
