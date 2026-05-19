// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Existing utilities
export { getRequiredEnv } from "./environment.js";
export { generateUniqueId } from "./id.js";
export {
    METRICS_NAMESPACE,
    OPERATIONAL_METRIC_EVENT_VERSION,
    OperationalMetricEvent,
    sendOperationalMetric,
    type OperationalMetricData,
    type OperationalMetricEnvelope
} from "./metrics.js";
export { getAwsClientConfig, type AwsClientConfig } from "./sdk-options.js";

// Structured logging
export { createLogger, type CreateLoggerParams, type Logger } from "./logger.js";

// Task orchestration types
export { TestStatus } from "./test-execution.js";
export type { TestExecutionInput, TestTaskRegionConfig, TestType } from "./test-execution.js";

// JSON utilities
export { parseSafeJson } from "./json.js";

export { EcsServiceStatus, StabilizationStatus } from "./orchestration.js";
export type {
    CompletionMonitoringEvent,
    RegionalSyncResult,
    ServiceStabilizationResult,
    TaskCancelEvent,
    TaskRunnerResult,
    TestCleanupEvent
} from "./orchestration.js";

export { classifyStopCode, StopCategory } from "./task-failure.js";
export type { TaskFailureTrackingFields } from "./task-failure.js";

// Structured log event identifiers
export { LogEvent } from "./log-events.js";

// ECS resource naming conventions and Step Functions execution naming
export {
    buildExecutionName,
    buildServiceName,
    buildTaskDefinitionFamily,
    DLT_SERVICE_PREFIX,
    parseExecutionName
} from "./naming.js";

// Stack compatibility
export { checkRegionalCompatibility, isUpdateAvailable } from "./stack-compatibility.js";
export type { CompatibilityResult } from "./stack-compatibility.js";
export { getLatestVersionFromRss } from "./latest-version.js";

// Date formatting utilities
export * from './date-utils.js';
