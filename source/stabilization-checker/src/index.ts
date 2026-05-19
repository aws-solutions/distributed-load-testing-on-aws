// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { OperationalMetricEnvelope, ServiceStabilizationResult, TaskRunnerResult } from "@amzn/dlt-common";
import {
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
  StabilizationStatus,
} from "@amzn/dlt-common";
import { ECSClient } from "@aws-sdk/client-ecs";

import { checkStabilization } from "./stabilization-check.js";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
const AWS_ACCOUNT_ID = getRequiredEnv("AWS_ACCOUNT_ID");

const metricEnvelope: OperationalMetricEnvelope = {
  solutionId: SOLUTION_ID,
  uuid: UUID,
  version: VERSION,
  metricUrl: METRIC_URL,
  accountId: AWS_ACCOUNT_ID,
  metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
};

/** 30-minute stabilization timeout in milliseconds. */
const STABILIZATION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Input shape for the Stabilization Checker Lambda.
 *
 * On the first invocation the step function passes a {@link TaskRunnerResult}
 * (no `stabilizationStartTime`). On subsequent iterations it passes the
 * previous {@link ServiceStabilizationResult} which includes
 * `stabilizationStartTime`. We accept both by making that field optional.
 */
interface StabilizationCheckerInput extends TaskRunnerResult {
  /** Present on subsequent iterations (passed through from previous PENDING result). */
  readonly stabilizationStartTime?: number;
}

/**
 * Stabilization Checker Lambda handler.
 *
 * Called in the step function's Wait → Lambda → Choice loop after the
 * Task Runner creates an ECS service. Each invocation checks whether
 * the service has reached its desired task count by inspecting the
 * primary deployment's rollout state.
 *
 * Returns a {@link ServiceStabilizationResult} with one of three statuses:
 * - READY: all tasks healthy and ready for test execution
 * - PENDING: service still stabilizing, step function loops back to Wait
 * - FAILED: circuit breaker triggered or 30-minute timeout exceeded
 */
export async function handler(event: StabilizationCheckerInput): Promise<ServiceStabilizationResult> {
  const { testId, testRunId, testTaskConfig } = event;
  const { region } = testTaskConfig;

  const logger = createLogger({ serviceName: "stabilization-checker", solutionId: SOLUTION_ID, version: VERSION });
  logger.appendKeys({ testId, testRunId, region });

  logger.info("Stabilization checker invoked", { serviceName: event.serviceName, desiredCount: event.desiredCount });

  // Track when stabilization polling started. First call won't have this;
  // subsequent calls carry it through from the previous PENDING result.
  const stabilizationStartTime = event.stabilizationStartTime ?? Date.now();

  // Build the common pass-through fields returned in every response
  const passThrough = {
    testId: event.testId,
    testRunId: event.testRunId,
    testType: event.testType,
    fileType: event.fileType,
    showLive: event.showLive,
    testDuration: event.testDuration,
    prefix: event.prefix,
    testTaskConfig: event.testTaskConfig,
    serviceName: event.serviceName,
    serviceArn: event.serviceArn,
    taskDefinitionArn: event.taskDefinitionArn,
    taskDefinitionFamily: event.taskDefinitionFamily,
    desiredCount: event.desiredCount,
    stabilizationStartTime,
  };

  // Check for 30-minute timeout before querying ECS
  const elapsed = Date.now() - stabilizationStartTime;
  if (elapsed >= STABILIZATION_TIMEOUT_MS) {
    const timeoutMsg = `Service failed to stabilize within 30 minutes (elapsed: ${Math.round(elapsed / 1000)}s)`;
    logger.error("Stabilization timeout", {
      logEvent: LogEvent.STABILIZATION_TIMEOUT,
      serviceName: event.serviceName,
      elapsedMs: elapsed,
    });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.ServiceStabilizeFailed,
      TestId: testId,
      TestRunId: testRunId,
      Region: region,
      Error: timeoutMsg,
    });

    return {
      ...passThrough,
      status: StabilizationStatus.FAILED,
      runningCount: 0,
      readyTimestamp: 0,
      errorMessage: timeoutMsg,
    };
  }

  const ecs = new ECSClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region }));

  const status = await checkStabilization({
    ecs,
    cluster: testTaskConfig.taskCluster,
    serviceName: event.serviceName,
    desiredCount: event.desiredCount,
    logger,
  });

  if (status.isFailed) {
    logger.error("Service stabilization failed", {
      logEvent: LogEvent.STABILIZATION_FAILED,
      serviceName: event.serviceName,
      errorMessage: status.errorMessage,
    });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.ServiceStabilizeFailed,
      TestId: testId,
      TestRunId: testRunId,
      Region: region,
      Error: status.errorMessage ?? "Unknown stabilization error",
    });

    return {
      ...passThrough,
      status: StabilizationStatus.FAILED,
      runningCount: status.runningCount,
      readyTimestamp: 0,
      ...(status.errorMessage !== undefined ? { errorMessage: status.errorMessage } : {}),
    };
  }

  if (!status.isStable) {
    logger.info("Service still stabilizing", {
      serviceName: event.serviceName,
      runningCount: status.runningCount,
      desiredCount: event.desiredCount,
    });
    return {
      ...passThrough,
      status: StabilizationStatus.PENDING,
      runningCount: status.runningCount,
      readyTimestamp: 0,
    };
  }

  const readyTimestamp = Date.now();
  const stabilizationDuration = readyTimestamp - stabilizationStartTime;

  logger.info("Service is ready", {
    logEvent: LogEvent.SERVICE_READY,
    serviceName: event.serviceName,
    stabilizationDuration,
  });

  await sendOperationalMetric(metricEnvelope, {
    Type: OperationalMetricEvent.ServiceReady,
    TestId: testId,
    TestRunId: testRunId,
    Region: region,
    TaskCount: status.runningCount,
    DesiredCount: event.desiredCount,
    StabilizationDuration: stabilizationDuration,
  });

  return {
    ...passThrough,
    status: StabilizationStatus.READY,
    runningCount: status.runningCount,
    readyTimestamp,
  };
}
