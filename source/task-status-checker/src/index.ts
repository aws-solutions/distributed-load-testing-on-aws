// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionMonitoringEvent, OperationalMetricEnvelope, TestTaskRegionConfig } from "@amzn/dlt-common";
import {
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
} from "@amzn/dlt-common";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { monitorCompletion } from "./completion.js";
import { computePollIntervalSeconds, GRACE_PERIOD_SECONDS } from "./poll-interval.js";
import { checkRunningStatus } from "./running-check.js";

/**
 * Pre-test running check event — dispatched when `serviceName` is absent.
 *
 * The step function invokes this before service creation to verify the
 * test is still in "running" status. If the user cancelled while tasks
 * were queued, this returns `isRunning: false` and the Map branch skips
 * service creation.
 */
export interface RunningCheckEvent {
  readonly testId: string;
  readonly testRunId: string;
  readonly testTaskConfig: TestTaskRegionConfig;
}

/**
 * Discriminated union: presence of `serviceName` determines which mode
 * the handler operates in.
 */
export type TaskStatusCheckerEvent = RunningCheckEvent | CompletionMonitoringEvent;

/**
 * Running check response — original event augmented with `isRunning`.
 */
export interface RunningCheckResponse extends RunningCheckEvent {
  readonly isRunning: boolean;
}

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const SCENARIOS_BUCKET = getRequiredEnv("SCENARIOS_BUCKET");
const MAIN_STACK_REGION = getRequiredEnv("MAIN_STACK_REGION");
const AWS_ACCOUNT_ID = getRequiredEnv("AWS_ACCOUNT_ID");

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }))
);

const metricEnvelope: OperationalMetricEnvelope = {
  solutionId: SOLUTION_ID,
  uuid: UUID,
  version: VERSION,
  metricUrl: METRIC_URL,
  accountId: AWS_ACCOUNT_ID,
  metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
};

/**
 * Determines whether the event is a completion monitoring event
 * (has `serviceName`) vs. a running check event.
 */
function isCompletionEvent(event: TaskStatusCheckerEvent): event is CompletionMonitoringEvent {
  return "serviceName" in event;
}

// CompletionState builds from a subset of updated CompletionMonitoringEvent fields via Pick<>,
// as well as an optional errorReason if applicable.
type CompletionState = Pick<
  CompletionMonitoringEvent,
  | "completedTaskCount"
  | "isComplete"
  | "maxDurationReached"
  | "timedOut"
  | "pollStartTime"
  | "pollIntervalSeconds"
  | "warningDeadline"
> & {
  readonly errorReason?: string;
};

// Update CompletionMonitoringEvent fields that change with each status check loop.
function withCompletionState(event: CompletionMonitoringEvent, state: CompletionState): CompletionMonitoringEvent {
  const result = { ...event, ...state };
  if (state.errorReason === undefined) {
    delete result.errorReason;
  }
  return result;
}

/**
 * Load test frameworks may exit for fatal reasons such as a bad script or the JMeter
 * JVM running out of memory. They may also exit for non-fatal reasons such as a
 * script-defined threshold for latency or error rate being breached.
 *
 * Since we cannot determine fatal vs non-fatal exits, we consider a meaningful number
 * of non-zero framework exit codes to be a "warning" signal.
 *
 * In the case of thresholds being breached, all tasks should complete within the alotted
 * "grace period", since each script will run for the same duration.
 *
 * In the case of fatal exits, tasks may exit significantly earlier than "healthy" tasks.
 * Once we exceed the healthy threshold, we start the "grace period" timer. If all tasks
 * are not completed within the grace period, we shut down the load test and consider it
 * a failure. We still parse available results and display available information to users.
 */
const WARNING_GRACE_PERIOD_MS = 120_000;

function evaluateWarningDeadline(input: {
  readonly event: CompletionMonitoringEvent;
  readonly warningTaskCount: number;
  readonly healthyThreshold: number;
  readonly isComplete: boolean;
  readonly maxDurationTimedOut: boolean;
  readonly warningDeadlineReached: boolean;
  readonly logger: ReturnType<typeof createLogger>;
}): {
  readonly warningDeadline: number | undefined;
  readonly warningTimedOut: boolean;
} {
  const { event, warningTaskCount, healthyThreshold, isComplete, maxDurationTimedOut, warningDeadlineReached, logger } =
    input;
  let warningDeadline = event.warningDeadline;

  if (event.nativeRunMode === null || isComplete || maxDurationTimedOut) {
    return { warningDeadline, warningTimedOut: false };
  }

  if (event.desiredCount > 0 && warningDeadline === undefined) {
    const healthyPercent = ((event.desiredCount - warningTaskCount) / event.desiredCount) * 100;
    if (healthyPercent < healthyThreshold) {
      warningDeadline = Date.now() + WARNING_GRACE_PERIOD_MS;
      logger.warn("Regional framework-warning threshold breached — starting grace period", {
        warningTaskCount,
        desiredCount: event.desiredCount,
        healthyThreshold,
        warningDeadline,
      });
    }
  }

  const warningTimedOut = warningDeadline !== undefined && warningDeadlineReached;
  return { warningDeadline, warningTimedOut };
}

// Update test scenario's failure details within the Scenarios table.
async function updateFailureStatus(
  ddb: DynamoDBDocumentClient,
  testId: string,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: SCENARIOS_TABLE,
        Key: { testId },
        UpdateExpression: "SET #s = :s, #e = :e",
        ExpressionAttributeNames: { "#s": "status", "#e": "errorReason" },
        ExpressionAttributeValues: { ":s": "failed", ":e": "Failed to check task status." },
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update DynamoDB status", { error: message });
  }
}

/**
 * Task Status Checker Lambda handler.
 *
 * Two modes of operation:
 *
 * 1. **Running Check** (no `serviceName`): Queries DynamoDB to confirm the
 *    test scenario is still in "running" status. Returns `{ ...event, isRunning }`.
 *
 * 2. **Completion Monitoring** (has `serviceName`): Checks DDB status for
 *    early failure detection, counts S3 completion markers, and enforces a
 *    deadline of `nativeRunMode.maxTestDurationSeconds + GRACE_PERIOD_SECONDS`
 *    for native tests, or `testDuration + GRACE_PERIOD_SECONDS` for legacy tests.
 */
export async function handler( // NOSONAR - S3776: keep orchestration linear until refactor
  event: TaskStatusCheckerEvent
): Promise<RunningCheckResponse | CompletionMonitoringEvent> {
  const logger = createLogger({ serviceName: "task-status-checker", solutionId: SOLUTION_ID, version: VERSION });
  const testId = event.testId;
  const region = event.testTaskConfig.region;
  logger.appendKeys({ testId, testRunId: event.testRunId, region });

  try {
    if (!isCompletionEvent(event)) {
      // ── Running Check Path ──
      logger.info("Running check mode");

      const { isRunning } = await checkRunningStatus({
        ddb,
        scenariosTable: SCENARIOS_TABLE,
        testId,
        logger,
      });

      return { ...event, isRunning };
    }

    // ── Completion Monitoring Path ──
    const pollStartTime = event.pollStartTime ?? Date.now();
    const elapsedSeconds = (Date.now() - pollStartTime) / 1000;
    const nativeMaxDuration = event.nativeRunMode?.maxTestDurationSeconds;
    const nativeMaxDurationReached = nativeMaxDuration ? elapsedSeconds > nativeMaxDuration : false;
    const maxDurationReached = event.maxDurationReached || nativeMaxDurationReached;
    const durationDeadlineSeconds = (nativeMaxDuration ?? event.testDuration) + GRACE_PERIOD_SECONDS;
    const maxDurationTimedOut = elapsedSeconds > durationDeadlineSeconds;

    // Recomputed rather than threaded through so it survives a redrive. Must be
    // returned on every path — the Wait state reads it via SecondsPath.
    const pollIntervalSeconds = computePollIntervalSeconds(nativeMaxDuration ?? event.testDuration);

    logger.info("Completion monitoring mode", {
      serviceName: event.serviceName,
      desiredCount: event.desiredCount,
      previousCompleted: event.completedTaskCount,
      pollStartTime,
      pollIntervalSeconds,
    });

    // Check if the test has been marked as failed (e.g., task failure threshold breached)
    const { isRunning, healthyThreshold = 90 } = await checkRunningStatus({
      ddb,
      scenariosTable: SCENARIOS_TABLE,
      testId,
      logger,
    });

    if (!isRunning && !maxDurationReached) {
      logger.error("Test is no longer running — short-circuiting completion monitor", {
        logEvent: LogEvent.COMPLETION_TIMEOUT,
      });

      await sendOperationalMetric(metricEnvelope, {
        Type: OperationalMetricEvent.CompletionThresholdBreached,
        TestId: testId,
        TestRunId: event.testRunId,
        Region: region,
        CompletedTaskCount: event.completedTaskCount ?? 0,
        DesiredCount: event.desiredCount,
      }).catch((err) => logger.warn("Failed to send CompletionThresholdBreached metric", { error: err }));

      return withCompletionState(event, {
        completedTaskCount: event.completedTaskCount ?? 0,
        isComplete: false,
        maxDurationReached: event.maxDurationReached ?? false,
        timedOut: true,
        pollStartTime,
        pollIntervalSeconds,
        errorReason: "Task failure threshold breached",
      });
    }

    const s3 = new S3Client(
      getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: MAIN_STACK_REGION })
    );
    const warningDeadlineReached = event.warningDeadline !== undefined && Date.now() >= event.warningDeadline;
    const completion = await monitorCompletion({
      s3,
      bucket: SCENARIOS_BUCKET,
      testId,
      prefix: event.prefix,
      region,
      desiredCount: event.desiredCount,
      logger,
    });

    const { completedTaskCount, isComplete, warningTaskCount } = completion;
    const warningGraceStarted = event.warningDeadline !== undefined;

    if (isComplete) {
      logger.info("All tasks completed", {
        logEvent: LogEvent.REGION_COMPLETE,
        completedTaskCount,
        desiredCount: event.desiredCount,
      });

      await sendOperationalMetric(metricEnvelope, {
        Type: OperationalMetricEvent.RegionComplete,
        TestId: testId,
        TestRunId: event.testRunId,
        Region: region,
        CompletedTaskCount: completedTaskCount,
        DesiredCount: event.desiredCount,
      }).catch((err) => logger.warn("Failed to send RegionComplete metric", { error: err }));
    }

    const warningState = evaluateWarningDeadline({
      event,
      warningTaskCount,
      healthyThreshold,
      isComplete,
      maxDurationTimedOut,
      warningDeadlineReached,
      logger,
    });
    const { warningDeadline, warningTimedOut } = warningState;

    const timedOut = maxDurationTimedOut || warningTimedOut;
    const errorReason = warningTimedOut ? "Framework warning threshold breached" : "Test execution timed out";
    const timeoutDeadlineSeconds =
      warningTimedOut && warningDeadline !== undefined
        ? Math.round((warningDeadline - pollStartTime) / 1000)
        : durationDeadlineSeconds;

    if (timedOut && !isComplete) {
      const timeoutCause = maxDurationTimedOut ? "execution_deadline" : "framework_warning_grace";
      logger.error("Completion monitoring timed out — deadline exceeded", {
        logEvent: LogEvent.COMPLETION_TIMEOUT,
        elapsedSeconds,
        deadline: timeoutDeadlineSeconds,
        completedTaskCount,
        desiredCount: event.desiredCount,
        warningTaskCount,
      });

      await sendOperationalMetric(metricEnvelope, {
        Type: OperationalMetricEvent.CompletionTimeout,
        TestId: testId,
        TestRunId: event.testRunId,
        Region: region,
        ElapsedSeconds: Math.round(elapsedSeconds),
        Deadline: timeoutDeadlineSeconds,
        CompletedTaskCount: completedTaskCount,
        DesiredCount: event.desiredCount,
        TimeoutCause: timeoutCause,
        WarningTaskCount: warningTaskCount,
        HealthyThreshold: healthyThreshold,
        WarningGraceStarted: warningGraceStarted,
      }).catch((err) => logger.warn("Failed to send CompletionTimeout metric", { error: err }));
    }

    const result = withCompletionState(event, {
      completedTaskCount,
      isComplete,
      maxDurationReached,
      timedOut,
      pollStartTime,
      pollIntervalSeconds,
      ...(warningDeadline !== undefined && { warningDeadline }),
      ...(timedOut && !isComplete && { errorReason }),
    });

    logger.info("Completion monitoring result", {
      completedTaskCount,
      isComplete,
      maxDurationReached,
      timedOut,
      elapsedSeconds,
      warningTaskCount,
      warningDeadline,
    });

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Task status checker failed", { error: message });

    await updateFailureStatus(ddb, testId, logger);
    throw new Error(message);
  }
}
