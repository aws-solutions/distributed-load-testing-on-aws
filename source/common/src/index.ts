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
    type OperationalMetricEnvelope
} from "./metrics.ts";
export { getAwsClientConfig, type AwsClientConfig } from "./sdk-options.ts";

// Structured logging
export { createLogger, type CreateLoggerParams, type Logger } from "./logger.ts";

// Task orchestration types
export { TestStatus, FRAMEWORKS, TEST_TYPE_TO_FRAMEWORK, MAX_TEST_DURATION_SECONDS } from "./test-execution.ts";
export type {
  TestExecutionInput,
  TestTaskRegionConfig,
  TestType,
  FileType,
  LoadTestFramework,
} from "./test-execution.ts";

// Native-mode wire schemas
export { LIVE_DATA_V1_SCHEMA } from "./schemas/live-data.ts";
export type { LiveDataEvent } from "./schemas/live-data.ts";
export { DLT_RESULT_V1_SCHEMA } from "./schemas/result.ts";
export type { DltResultV1, LabelAggregate, ResponseCodeCount, TaskMetadata } from "./schemas/result.ts";

// JSON utilities
export { parseSafeJson } from "./json.ts";

export { EcsServiceStatus, StabilizationStatus } from "./orchestration.ts";
export type {
    CompletionMonitoringEvent,
    RegionalSyncResult,
    ServiceStabilizationResult,
    TaskCancelEvent,
    TaskRunnerResult,
    TestCleanupEvent
} from "./orchestration.ts";

export { classifyStopCode, StopCategory } from "./task-failure.ts";
export type { TaskFailureTrackingFields } from "./task-failure.ts";

// Structured log event identifiers
export { LogEvent } from "./log-events.ts";

// ECS resource naming conventions and Step Functions execution naming
export {
    buildExecutionName,
    buildServiceName,
    buildTaskDefinitionFamily,
    DLT_SERVICE_PREFIX,
    parseExecutionName
} from "./naming.ts";

// Stack compatibility
export { checkRegionalCompatibility, isUpdateAvailable } from "./stack-compatibility.ts";
export type { CompatibilityResult } from "./stack-compatibility.ts";
export { getLatestVersionFromRss } from "./latest-version.ts";

// Date formatting utilities
export * from './date-utils.ts';

// Cron utilities
export * from './cron.ts';

// Scenario counter
export { incrementTestRunCount, decrementTestRunCount } from './scenario-counter.ts';
