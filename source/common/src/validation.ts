// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Browser-safe validation entrypoint. Keep Node-only utilities out of this module.
export { MAX_TEST_DURATION_SECONDS, MAX_TEST_RUNS_PER_DELETE_REQUEST, MAX_VIRTUAL_USERS } from "./api/limits.ts";
// Scenario status vocabulary and guards — single source of truth shared with clients.
export {
  ACTIVE_RUN_STATUSES,
  isActiveRunStatus,
  isBaselineEligibleRunStatus,
  isCancelableRunStatus,
  isTerminalRunStatus,
  TERMINAL_RUN_STATUSES,
  TestStatus,
} from "./test-execution.ts";
export { maxTestDurationSecondsSchema, nativeRunModeSchema } from "./api/create-test.ts";
export type { NativeRunMode } from "./api/create-test.ts";
export {
  concurrencySchema,
  createTestSchema,
  healthyThresholdSchema,
  holdForSchema,
  rampUpSchema,
  scheduleDateSchema,
  scheduleTimeSchema,
  taskCountSchema,
  testDescriptionSchema,
  testNameSchema,
  urlSchema,
} from "./api/schemas.ts";
export type { TestScenarioValidation } from "./api/schemas.ts";
