// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * Zod validation schemas for API inputs
 */

// ============================================================================
// Custom Validators and Refinements
// ============================================================================

/**
 * Validates that a string is a valid AWS region format
 */
const regionSchema = z
  .string()
  .regex(/^[a-z]{2}-[a-z]+-\d$/, "Invalid region format (expected: us-west-2, eu-central-1, etc.)");

/**
 * Validates ISO 8601 date string
 */
const isoDateString = z
  .string()
  .refine((val: string) => !isNaN(Date.parse(val)), "Invalid date format. Expected ISO 8601 format");

/**
 * Validates cron expression (Linux format: min hour day month dayOfWeek)
 */
const cronExpressionSchema = z.string().regex(
  /^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([0-2]?\d|3[01])) (\*|([1-9]|1[0-2])) (\*|[0-7])$/, // NOSONAR
  "Invalid cron expression format. Expected 5 field cron expression (example: * * * * *)."
);

/**
 * Validates time duration strings with suffix-based limits
 * Supports: s (seconds), m (minutes), h (hours), d (days)
 * Applies different maximum limits based on the time unit
 *
 * @param {string | number} value - The duration value to validate (string with suffix or number)
 * @param {string} fieldName - The field name for error messages
 * @param {boolean} allowZero - Whether to allow zero values (default: true)
 * @returns {string | true} true if valid, error message string if invalid
 */
const validateTimeDuration = (value: string | number, fieldName: string, allowZero: boolean = true): string | true => {
  // If it's a number, allow it for backward compatibility
  if (typeof value === "number") {
    if (!allowZero && value <= 0) {
      return `${fieldName} must be a positive number`;
    }
    if (allowZero && value < 0) {
      return `${fieldName} must be a non-negative number`;
    }
    return true;
  }

  // Parse string format: number + suffix
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    return `${fieldName} must be in format: number followed by s, m, h, or d`;
  }

  const numValue = parseInt(match[1], 10);
  const suffix = match[2];

  // Check minimum value
  if (!allowZero && numValue === 0) {
    return `${fieldName} must be greater than 0`;
  }

  // Apply suffix-specific maximum limits
  const limits: Record<string, { max: number; unit: string }> = {
    s: { max: 3600, unit: "seconds" },
    m: { max: 1440, unit: "minutes" },
    h: { max: 168, unit: "hours" },
    d: { max: 30, unit: "days" },
  };

  const limit = limits[suffix];
  if (numValue > limit.max) {
    return `${fieldName}: value ${numValue} exceeds maximum of ${limit.max} ${limit.unit}`;
  }

  return true;
};

/**
 * Schema for ramp-up duration with suffix-based validation
 * Allows: string format (0-3600s, 0-1440m, 0-168h, 0-30d) or non-negative integer
 */
const rampUpSchema = z
  .union([
    z.string().regex(/^\d+[smhd]$/, "ramp-up must be in format: number followed by s, m, h, or d"),
    z.number().int().nonnegative(),
  ])
  .refine(
    (val: string | number) => validateTimeDuration(val, "ramp-up", true) === true,
    (val: string | number) => ({ message: validateTimeDuration(val, "ramp-up", true) as string })
  );

/**
 * Schema for hold-for duration with suffix-based validation
 * Allows: string format (1-3600s, 1-1440m, 1-168h, 1-30d) or positive integer
 */
const holdForSchema = z
  .union([
    z.string().regex(/^\d+[smhd]$/, "hold-for must be in format: number followed by s, m, h, or d"),
    z.number().int().positive(),
  ])
  .refine(
    (val: string | number) => validateTimeDuration(val, "hold-for", false) === true,
    (val: string | number) => ({ message: validateTimeDuration(val, "hold-for", false) as string })
  );

/**
 * Schema for concurrency with validated limits
 * Allows: integer or string format, must be between 1 and 25000
 */
const concurrencySchema = z
  .union([z.number().int(), z.string().regex(/^\d+$/, "concurrency must be a positive integer")])
  .transform((val: string | number) => (typeof val === "string" ? parseInt(val, 10) : val))
  .refine((val: number) => val >= 1 && val <= 25000, "concurrency must be between 1 and 25000");

// ============================================================================
// Path Parameters
// ============================================================================

/**
 * Validates testId path parameter
 * - Required
 * - String type
 * - Length: 1-128 characters
 * - Alphanumeric and hyphens only
 */
export const testIdSchema = z
  .string()
  .min(1, "testId is required")
  .max(128, "testId must not exceed 128 characters")
  .regex(/^[a-zA-Z0-9-]+$/, "testId must contain only alphanumeric characters and hyphens");

/**
 * Validates testRunId path parameter
 * - Required when present
 * - String type
 * - Length: 1-128 characters
 * - Alphanumeric and hyphens only
 */
export const testRunIdSchema = z
  .string()
  .min(1, "testRunId is required")
  .max(128, "testRunId must not exceed 128 characters")
  .regex(/^[a-zA-Z0-9-]+$/, "testRunId must contain only alphanumeric characters and hyphens");

/**
 * Combined path parameters schema
 */
export const pathParametersSchema = z.object({
  testId: testIdSchema.optional(),
  testRunId: testRunIdSchema.optional(),
});

// ============================================================================
// Query Parameters
// ============================================================================

/**
 * Query parameters for GET /scenarios
 */
export const scenariosQuerySchema = z
  .object({
    op: z.enum(["listRegions"]).optional(),
    tags: z.string().max(500, "Tags parameter too long").optional(),
  })
  .strict();

/**
 * Query parameters for GET /scenarios/{testId}
 */
export const scenarioQuerySchema = z
  .object({
    history: z.enum(["true", "false"]).optional(),
    latest: z.enum(["true", "false"]).optional(),
  })
  .strict();

/**
 * Query parameters for GET /scenarios/{testId}/testruns
 */
export const testRunsQuerySchema = z
  .object({
    limit: z
      .union([z.string().regex(/^\d+$/, "Limit must be a number"), z.number()])
      .optional()
      .transform((val: string | number | undefined) => (typeof val === "string" ? parseInt(val, 10) : val))
      .refine(
        (val: number | undefined) => val === undefined || (val >= 1 && val <= 100),
        "Limit must be between 1 and 100"
      ),
    start_timestamp: isoDateString.optional(),
    end_timestamp: isoDateString.optional(),
    latest: z.enum(["true", "false"]).optional(),
    next_token: z.string().optional(),
  })
  .strict();

/**
 * Query parameters for GET /scenarios/{testId}/baseline
 */
export const baselineQuerySchema = z
  .object({
    data: z.enum(["true", "false"]).optional(),
  })
  .strict();

// ============================================================================
// Request Body Schemas
// ============================================================================

/**
 * Test task configuration schema
 */
const testTaskConfigSchema = z.object({
  region: regionSchema,
  taskCount: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/, "taskCount must be a positive integer")])
    .transform((val: string | number) => (typeof val === "string" ? parseInt(val, 10) : val)),
  concurrency: concurrencySchema,
});

/**
 * Test scenario execution schema
 */
const testScenarioExecutionSchema = z
  .object({
    concurrency: concurrencySchema.optional(),
    "ramp-up": rampUpSchema.optional(),
    "hold-for": holdForSchema.optional(),
    scenario: z.string().optional(),
    executor: z.enum(["locust", "k6", "jmeter"]).optional(),
    taskCount: z.number().int().positive().optional(),
  })
  .passthrough(); // Allow additional properties for flexibility

/**
 * Scenario request schema (HTTP request configuration)
 */
const scenarioRequestSchema = z
  .object({
    url: z
      .string()
      .min(1, "url is required")
      .max(2048, "url must not exceed 2048 characters")
      .url("url must be a valid URL")
      .refine((url: string) => url.startsWith("http://") || url.startsWith("https://"), {
        message: "url must be a valid HTTP/HTTPS URL",
      }),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"], {
      errorMap: () => ({
        message: "method must be a valid HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)",
      }),
    }),
    headers: z.record(z.string()).optional(),
    body: z.string().max(65536, "body must not exceed 65536 characters").optional(),
  })
  .passthrough(); // Allow additional tool-specific fields

/**
 * Individual scenario configuration schema
 */
const scenarioConfigSchema = z
  .object({
    requests: z
      .array(scenarioRequestSchema)
      .min(1, "Each scenario must have at least one request")
      .max(100, "Each scenario cannot exceed 100 requests")
      .optional(),
  })
  .passthrough(); // Allow additional tool-specific fields

/**
 * Scenarios object schema (collection of named scenarios)
 * Validates scenario names and ensures at least one scenario exists
 */
const scenariosSchema = z
  .record(
    z
      .string()
      .min(1, "Scenario name cannot be empty")
      .max(128, "Scenario name must not exceed 128 characters")
      .regex(
        /^[a-zA-Z0-9\s\-_()]+$/,
        "Scenario name can only contain letters, numbers, spaces, hyphens, underscores, and parentheses"
      )
      .refine((val: string) => val.trim().length > 0, "Scenario name cannot be only whitespace"),
    scenarioConfigSchema
  )
  .refine(
    (scenarios: Record<string, unknown>) => Object.keys(scenarios).length > 0,
    "At least one scenario must be defined in scenarios object"
  );

/**
 * Test scenario schema
 */
const testScenarioSchema = z
  .object({
    execution: z.array(testScenarioExecutionSchema).min(1, "At least one execution configuration is required"),
    scenarios: scenariosSchema.optional(),
    reporting: z
      .array(
        z
          .object({
            module: z.string(),
            summary: z.boolean().optional(),
            percentiles: z.boolean().optional(),
            "summary-labels": z.boolean().optional(),
            "test-duration": z.boolean().optional(),
            "dump-xml": z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

/**
 * Regional task details schema
 */
const regionalTaskDetailsSchema = z.record(
  z.string(), // region key
  z
    .object({
      dltAvailableTasks: z.union([
        z.number().int().positive(),
        z.string().regex(/^\d+$/, "dltAvailableTasks must be a positive integer"),
      ]),
    })
    .passthrough()
);

/**
 * Tags array schema
 * - Max 5 tags
 * - Each tag: 1-50 characters
 * - Alphanumeric and hyphens only (after normalization)
 */
const tagsSchema = z.array(z.string()).max(5, "Maximum 5 tags allowed per scenario").optional();

/**
 * Schedule date schema (YYYY-MM-DD format)
 */
const scheduleDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Invalid date format. Expected format: YYYY-MM-DD");

/**
 * Schedule time schema (HH:MM or HH:MM:SS format)
 */
const scheduleTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/, "Invalid time format. Expected format: HH:MM or HH:MM:SS");

/**
 * POST /scenarios - Create Test Request
 */
export const createTestSchema = z
  .object({
    testId: testIdSchema.optional(),
    testName: z
      .string()
      .min(3, "testName must be at least 3 characters")
      .max(255, "testName must not exceed 255 characters")
      .regex(
        /^[a-zA-Z0-9\s\-_()]+$/,
        "testName can only contain letters, numbers, spaces, hyphens, underscores, and parentheses"
      ),
    testDescription: z
      .string()
      .min(3, "testDescription must be at least 3 characters")
      .max(60000, "testDescription must not exceed 60000 characters"),
    testType: z.enum(["simple", "jmeter", "locust", "k6"], {
      errorMap: () => ({ message: "testType must be one of: simple, jmeter, locust, k6" }),
    }),
    fileType: z.enum(["none", "script", "zip"]).optional(),
    testTaskConfigs: z.array(testTaskConfigSchema).min(1, "At least one test task configuration is required"),
    testScenario: testScenarioSchema,
    showLive: z.boolean().optional(),
    regionalTaskDetails: regionalTaskDetailsSchema,
    tags: tagsSchema,
    scheduleStep: z.enum(["create", "start"]).optional(),
    scheduleDate: scheduleDateSchema.optional(),
    scheduleTime: scheduleTimeSchema.optional(),
    recurrence: z.enum(["daily", "weekly", "biweekly", "monthly"]).optional(),
    cronValue: cronExpressionSchema.optional(),
    cronExpiryDate: scheduleDateSchema.optional(),
    eventBridge: z.string().optional(),
  })
  .passthrough() // Allow additional fields for backward compatibility
  .superRefine((data, ctx: z.RefinementCtx) => {
    // Cross-validate: Ensure execution references valid scenarios
    const scenarioNames = Object.keys(data.testScenario.scenarios || {});
    const executionArray = data.testScenario.execution || [];

    executionArray.forEach((exec: z.infer<typeof testScenarioExecutionSchema>, index: number) => {
      if (exec.scenario && !scenarioNames.includes(exec.scenario)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["testScenario", "execution", index, "scenario"],
          message: `Execution references scenario '${exec.scenario}' that doesn't exist in scenarios object`,
        });
      }
    });
  });

/**
 * PUT /scenarios/{testId}/baseline - Set Baseline Request
 */
export const setBaselineSchema = z
  .object({
    testRunId: testRunIdSchema,
  })
  .strict();

/**
 * DELETE /scenarios/{testId}/testruns - Delete Test Runs Request
 */
export const deleteTestRunsSchema = z.array(testRunIdSchema).min(1, "At least one testRunId is required");

// ============================================================================
// Validation Helper Types
// ============================================================================

export type TestIdValidation = z.infer<typeof testIdSchema>;
export type TestRunIdValidation = z.infer<typeof testRunIdSchema>;
export type PathParametersValidation = z.infer<typeof pathParametersSchema>;
export type ScenariosQueryValidation = z.infer<typeof scenariosQuerySchema>;
export type ScenarioQueryValidation = z.infer<typeof scenarioQuerySchema>;
export type TestRunsQueryValidation = z.infer<typeof testRunsQuerySchema>;
export type BaselineQueryValidation = z.infer<typeof baselineQuerySchema>;
export type CreateTestValidation = z.infer<typeof createTestSchema>;
export type SetBaselineValidation = z.infer<typeof setBaselineSchema>;
export type DeleteTestRunsValidation = z.infer<typeof deleteTestRunsSchema>;
