// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  FRAMEWORKS,
  TEST_TYPES,
  concurrencySchema,
  healthyThresholdSchema,
  regionSchema,
  tagsSchema,
  taskCountSchema,
  testDescriptionSchema,
  testIdSchema,
  testNameSchema,
  testRunIdSchema,
  testScenarioSchema,
  nativeRunModeSchema,
} from "@amzn/dlt-common";
import { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Event objects will include tool parameters and are specific to the tool being invoked.
 * Each tool will perform its own validation.
 */
export type AgentCoreEvent = Record<string, unknown>;

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
 * Valid test types — derived from @amzn/dlt-common TestType.
 */
export const VALID_TEST_TYPES = [...TEST_TYPES] as [string, ...string[]];

/**
 * Valid script-based test types — materialized from the shared set for Zod.
 */
export const VALID_FRAMEWORKS = [...FRAMEWORKS] as [string, ...string[]];

/**
 * Base schema with only the `test_id` defined. This is a common schema we can reuse.
 */
export const BaseTestIdSchema = z.object({
  test_id: testIdSchema,
});

/**
 * Base schema with `test_id` and `test_run_id`. This is a common schema we can reuse.
 */
export const BaseTestRunSchema = BaseTestIdSchema.extend({
  test_run_id: testRunIdSchema,
});

/**
 * Base schema shared by the existing scenario write tools (update test and schedules).
 * Tool-specific schemas extend this with their extra fields (e.g. schedule/cron params).
 * Same as BaseScenarioSchema except `test_id` is required.
 */
export const BaseExistingScenarioSchema = BaseTestIdSchema.extend({
  // Auto-trim, then reuse the shared name schema so MCP validation matches the API contract.
  test_name: z.string().trim().pipe(testNameSchema),
  test_description: testDescriptionSchema,
  test_type: z.enum(VALID_TEST_TYPES),
  test_task_configs: z.array(z.object({
    region: regionSchema,
    task_count: taskCountSchema,
    concurrency: concurrencySchema,
  })),
  test_scenario: testScenarioSchema,
  show_live: z.boolean().optional(),
  tags: tagsSchema,
  healthy_threshold: healthyThresholdSchema.optional(),
  native_run_mode: nativeRunModeSchema.optional(),
});

/**
 * Base schema shared by the new scenario write tools (create test and schedules).
 * Tool-specific schemas extend this with their extra fields (e.g. schedule/cron params)
 * Same as BaseExistingScenarioSchema except `test_id` is optional.
 */
export const BaseScenarioSchema = BaseExistingScenarioSchema.partial({
  test_id: true,
});

/**
 * Helper function to safely parse and validate event parameters using Zod schema
 * Converts ZodError to AppError with proper 400 status code
 */
export function parseEventWithSchema<T>(schema: z.ZodType<T>, event: AgentCoreEvent): T {
  try {
    return schema.parse(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues
        .map((issue: z.core.$ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new AppError(`Validation failed: ${errorMessages}`, 400);
    }
    throw error; // generic Error objects will be converted to 500 Internal Service Error in Lambda handler
  }
}
