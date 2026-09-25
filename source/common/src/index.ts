// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Existing utilities
export { getRequiredEnv } from "./environment.ts";
export { generateUniqueId } from "./id.ts";
export {
  METRICS_NAMESPACE,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
  type OperationalMetricData,
  type OperationalMetricEnvelope,
} from "./metrics.ts";
export { getAwsClientConfig, type AwsClientConfig } from "./sdk-options.ts";

// Structured logging
export { createLogger, type CreateLoggerParams, type Logger } from "./logger.ts";

// Task orchestration types
export {
  ACTIVE_RUN_STATUSES,
  CANCELABLE_RUN_STATUSES,
  FILE_TYPES,
  FRAMEWORKS,
  isActiveRunStatus,
  isBaselineEligibleRunStatus,
  isCancelableRunStatus,
  isFileType,
  isLoadTestFramework,
  isTerminalRunStatus,
  isTestType,
  TERMINAL_RUN_STATUSES,
  TEST_TYPE_TO_FRAMEWORK,
  TEST_TYPES,
  TestStatus,
} from "./test-execution.ts";
export type {
  FileType,
  LoadTestFramework,
  TestExecutionInput,
  TestTaskRegionConfig,
  TestType,
} from "./test-execution.ts";

// Native-mode API request contract
export { maxTestDurationSecondsSchema, nativeRunModeSchema, nativeTestFieldsShape } from "./api/create-test.ts";
export type { NativeRunMode } from "./api/create-test.ts";
export { MAX_TEST_DURATION_SECONDS, MAX_TEST_RUNS_PER_DELETE_REQUEST, MAX_VIRTUAL_USERS } from "./api/limits.ts";

// API request validation schemas (single source of truth for what the API accepts)
export {
  baselineQuerySchema,
  concurrencySchema,
  createTestSchema,
  cronExpressionSchema,
  deleteTestRunsSchema,
  healthyThresholdSchema,
  holdForSchema,
  pathParametersSchema,
  rampUpSchema,
  recurrenceSchema,
  regionSchema,
  scheduleDateSchema,
  scheduleTimeSchema,
  scheduleTimezoneSchema,
  scenarioQuerySchema,
  scenariosQuerySchema,
  setBaselineSchema,
  tagsSchema,
  taskCountSchema,
  testDescriptionSchema,
  testIdSchema,
  testNameSchema,
  testRunIdSchema,
  testRunsQuerySchema,
  testScenarioSchema,
  urlSchema,
} from "./api/schemas.ts";
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
} from "./api/schemas.ts";

// Native-mode wire schemas
export { LIVE_DATA_FILTER_MARKER, LIVE_DATA_V1_SCHEMA, parseLiveDataPoint } from "./schemas/live-data.ts";
export type { LiveDataEvent, LiveDataPoint } from "./schemas/live-data.ts";
export { DLT_FRAMEWORK_EXIT_V1_SCHEMA } from "./schemas/framework-exit.ts";
export type { DltFrameworkExitV1 } from "./schemas/framework-exit.ts";
export { DLT_RESULT_V1_SCHEMA, LATENCY_HISTOGRAM_LAYOUT_ID } from "./schemas/result.ts";
export type {
  AggregateState,
  DistributionState,
  DltResultV1,
  HistogramState,
  LabelState,
  LabelAggregate,
  MeanState,
  ResponseCodeCount,
  ResponseCodeState,
  ResultAccumulatorState,
  TaskMetadata,
} from "./schemas/result.ts";
// JSON utilities
export { parseSafeJson } from "./json.ts";

export { EcsServiceStatus, StabilizationStatus } from "./orchestration.ts";
export type {
  CompletionMonitoringEvent,
  RegionalSyncResult,
  ServiceStabilizationResult,
  TaskCancelEvent,
  TaskRunnerResult,
  TestCleanupEvent,
} from "./orchestration.ts";

export { classifyStopCode, sanitizeStopReason, StopCategory } from "./task-failure.ts";
export type { TaskFailureTrackingFields } from "./task-failure.ts";

// Setup-phase failure surfacing (Task Runner and other setup Lambdas).
// getSetupErrorReason is the primary entry point — callers just need the curated
// message. SetupErrorCode + SETUP_ERROR_MESSAGES are exported so tests can assert
// the exact surfaced message. classifySetupError stays internal to setup-errors.ts.
export { getSetupErrorReason, SETUP_ERROR_MESSAGES, SetupErrorCode } from "./setup-errors.ts";

// Structured log event identifiers
export { LogEvent } from "./log-events.ts";

// Traffic-shape mode names and definitions — the single wording source shared by
// the console, the CLI, the MCP server, and the docs. The console imports the
// browser-safe "@amzn/dlt-common/traffic-shape" subpath instead of this barrel.
export {
  TRAFFIC_SHAPE_DECISION_TABLE,
  TRAFFIC_SHAPE_LABELS,
  TRAFFIC_SHAPE_LONG_DEFINITIONS,
  TRAFFIC_SHAPE_MEDIUM_DEFINITIONS,
  TRAFFIC_SHAPE_SHORT_DEFINITIONS,
} from "./traffic-shape.ts";
export type { TrafficShapeDecision, TrafficShapeMode } from "./traffic-shape.ts";

// ECS resource naming conventions and Step Functions execution naming
export {
  buildExecutionName,
  buildLiveDataStreamPrefix,
  buildServiceName,
  buildTaskDefinitionFamily,
  DLT_SERVICE_PREFIX,
  LIVE_DATA_LOG_STREAM_PREFIX,
  parseExecutionName,
  parseTestIdFromLogStream,
} from "./naming.ts";

// Stack compatibility
export { getLatestVersionFromRss } from "./latest-version.ts";
export { checkRegionalCompatibility, isUpdateAvailable } from "./stack-compatibility.ts";
export type { CompatibilityResult } from "./stack-compatibility.ts";

// Scenario record schema and types
export { ScenariosRepository } from "./scenarios/repository.ts";
export type { ScenariosRepositoryConfig } from "./scenarios/repository.ts";
export { scenarioRecordSchema } from "./scenarios/schema.ts";
export type { ScenarioRecord, TestTaskConfig } from "./scenarios/schema.ts";

// Data access
export { AppError, ConflictError, InvalidDataError, NotFoundError } from "./data/errors.ts";
export type { Result } from "./data/result.ts";

// Date formatting utilities
export * from "./date-utils.ts";

// Cron utilities
export * from "./cron.ts";

// Scenario counter
export { decrementTestRunCount, incrementTestRunCount } from "./scenario-counter.ts";

// S3 key contracts
export {
  artifactKeyPrefix,
  completionMarkerKey,
  entryNameFor,
  isControlChar,
  FRAMEWORK_EXIT_REPORT_FILENAME,
  FRAMEWORK_EXIT_REPORT_PREFIX,
  fileTypeForAssetFilename,
  frameworkExitReportKey,
  getTestAssetCandidates,
  startSignalKey,
  testConfigKey,
  testScriptKey,
  type TestAssetExtension,
  type TestAssetFileType,
  type TestAssetObject,
} from "./s3-keys.ts";
