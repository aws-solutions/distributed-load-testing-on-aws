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
 * Shared length bounds for user-facing names (testName and scenario names).
 * testName is used verbatim as the scenarios-map key, so both share limits.
 */
const NAME_MIN = 3;
const NAME_MAX = 255;

/**
 * Matches a single disallowed control character: C0 controls, DEL + C1 controls,
 * and Unicode line/paragraph separators. Everything else (punctuation, CJK,
 * accents, emoji) is allowed — names are never used as an S3/DynamoDB/ECS/metric
 * identifier (those use the generated testId), only as a JSON key + display text.
 */
// eslint-disable-next-line no-control-regex -- intentionally matches control characters in order to reject them
const CONTROL_CHAR = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;

/** Friendly names for the control chars a user is most likely to paste in. */
const CONTROL_CHAR_NAMES: Record<number, string> = {
  0x00: "null",
  0x09: "tab",
  0x0a: "newline",
  0x0d: "carriage return",
};

/**
 * Describes a control char as "name (U+XXXX)", or just "U+XXXX" if uncommon.
 * @param codePoint
 */
function describeControlChar(codePoint: number): string {
  const hex = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  const name = CONTROL_CHAR_NAMES[codePoint];
  return name ? `${name} (${hex})` : hex;
}

/**
 * Builds a Zod schema for a user-facing name (testName / scenario name).
 * Rejects only control characters (naming the offending char) and leading/trailing
 * whitespace, and enforces the shared min/max length. Disallowing surrounding
 * whitespace keeps the min-length meaningful (no space padding) and avoids
 * near-blank names; the name is stored verbatim as the scenarios-map key, so it
 * is validated — not silently trimmed.
 * @param label
 */
function nameSchema(label: string) {
  return z
    .string()
    .min(NAME_MIN, `${label} must be at least ${NAME_MIN} characters`)
    .max(NAME_MAX, `${label} must not exceed ${NAME_MAX} characters`)
    .refine((val: string) => val === val.trim(), `${label} cannot have leading or trailing whitespace`)
    .refine(
      (val: string) => !CONTROL_CHAR.test(val),
      (val: string) => {
        const codePoint = CONTROL_CHAR.exec(val)![0].codePointAt(0)!;
        return { message: `${label} contains a disallowed control character: ${describeControlChar(codePoint)}` };
      }
    );
}

/**
 * Validates that a string is a valid AWS region format.
 * Supports commercial (us-west-2), GovCloud (us-gov-west-1), and other partitions.
 */
const regionSchema = z
  .string()
  .regex(
    /^[a-z]{2}(-gov)?-[a-z]+-\d$/,
    "Invalid region format (expected: us-west-2, us-gov-west-1, eu-central-1, etc.)"
  );

/**
 * Validates ISO 8601 date string
 */
const isoDateString = z
  .string()
  .refine((val: string) => !isNaN(Date.parse(val)), "Invalid date format. Expected ISO 8601 format");

/**
 * Validates cron expression (Linux format: min hour day month dayOfWeek)
 * Supports hour step values and comma lists, day-of-week ranges and lists
 */
const CRON_EXPRESSION_REGEX =
  /^([0-5]?\d) ((\*|\*\/\d+|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?)(,(\*|\*\/\d+|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?))*) (\?|(\*|L|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?(,(\*|L|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?)*) ((\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC])(-(\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC]))?(\/\d+)?(,((\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC])(-(\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC]))?(\/\d+)?))*) (\?|L|(\*|[0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])(#[1-5]|L?(-([0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])L?)?(,(L|(\*|[0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])(L?(-([0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])L?)?)?))*)?)$/; // NOSONAR

const cronExpressionSchema = z.string().regex(
  CRON_EXPRESSION_REGEX, // NOSONAR
  "Invalid cron expression format. Hours support step values and lists. Day-of-week supports ranges and lists."
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
  .record(nameSchema("Scenario name"), scenarioConfigSchema)
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
    testName: nameSchema("testName"),
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
    scheduleTimezone: z.string().max(64, "scheduleTimezone must not exceed 64 characters").optional(),
    eventBridge: z.string().optional(),
    saveOnly: z.boolean().optional(),
    healthyThreshold: z
      .number()
      .int("healthyThreshold must be an integer")
      .min(0, "healthyThreshold must be between 0 and 100")
      .max(100, "healthyThreshold must be between 0 and 100")
      .optional()
      .default(90),
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
