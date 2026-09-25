// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Zod validation schemas for API inputs.
 *
 * The schema definitions live in `@amzn/dlt-common` so the API and the CLI
 * share a single source of truth for the request contract. This module simply
 * re-exports them, keeping existing `./schemas` import paths stable and the
 * request-validation behavior unchanged.
 */
export {
  baselineQuerySchema,
  createTestSchema,
  deleteTestRunsSchema,
  pathParametersSchema,
  scenarioQuerySchema,
  scenariosQuerySchema,
  setBaselineSchema,
  testIdSchema,
  testRunIdSchema,
  testRunsQuerySchema,
} from "@amzn/dlt-common";
export type {
  BaselineQueryValidation,
  CreateTestValidation,
  DeleteTestRunsValidation,
  PathParametersValidation,
  ScenarioQueryValidation,
  ScenariosQueryValidation,
  SetBaselineValidation,
  TestIdValidation,
  TestRunIdValidation,
  TestRunsQueryValidation,
} from "@amzn/dlt-common";
