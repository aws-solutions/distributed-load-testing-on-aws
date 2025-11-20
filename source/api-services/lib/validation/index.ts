// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Main entry point for validation module
 * Exports all validation functions, schemas, and utilities
 */

// Export all validation functions
export {
  validateTestId,
  validateTestRunId,
  validatePathParameters,
  validateScenariosQuery,
  validateScenarioQuery,
  validateTestRunsQuery,
  validateBaselineQuery,
  validateCreateTestBody,
  validateSetBaselineBody,
  validateDeleteTestRunsBody,
  validateQueryForResource,
  validateBodyForResource,
} from "./validators";

// Export schemas for advanced use cases
export {
  testIdSchema,
  testRunIdSchema,
  pathParametersSchema,
  scenariosQuerySchema,
  scenarioQuerySchema,
  testRunsQuerySchema,
  baselineQuerySchema,
  createTestSchema,
  setBaselineSchema,
  deleteTestRunsSchema,
} from "./schemas";

// Export error utilities
export { formatZodError, getFirstZodError, groupZodIssuesByPath, zodIssuesToValidationErrors } from "./errors";

// Export TypeScript types
export type {
  TestIdValidation,
  TestRunIdValidation,
  PathParametersValidation,
  ScenariosQueryValidation,
  ScenarioQueryValidation,
  TestRunsQueryValidation,
  BaselineQueryValidation,
  CreateTestValidation,
  SetBaselineValidation,
  DeleteTestRunsValidation,
} from "./schemas";
