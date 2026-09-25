// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  Logger,
  NativeRunMode,
  OperationalMetricEnvelope,
  ServiceStabilizationResult,
  TaskRunnerResult,
  TestExecutionInput,
  TestTaskRegionConfig,
} from "@amzn/dlt-common";
import {
  buildServiceName,
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  getSetupErrorReason,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
  StabilizationStatus,
  TEST_TYPE_TO_FRAMEWORK,
  TestStatus,
} from "@amzn/dlt-common";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { createDashboard as createTaurusDashboard } from "./dashboard.js";
import { createEcsService } from "./service.js";
import { createTestTaskDefinition } from "./task-definition.js";

/**
 * The step function Map state iterates over testTaskConfig[], so each
 * invocation receives the top-level fields plus a single TestTaskRegionConfig
 * (not an array).
 */
interface TaskRunnerEvent extends Omit<TestExecutionInput, "testTaskConfig"> {
  readonly testTaskConfig: TestTaskRegionConfig;
}

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const SCENARIOS_BUCKET = getRequiredEnv("SCENARIOS_BUCKET");
const MAIN_STACK_REGION = getRequiredEnv("MAIN_STACK_REGION");
const AWS_ACCOUNT_ID = getRequiredEnv("AWS_ACCOUNT_ID");

const metricEnvelope: OperationalMetricEnvelope = {
  solutionId: SOLUTION_ID,
  uuid: UUID,
  version: VERSION,
  metricUrl: METRIC_URL,
  accountId: AWS_ACCOUNT_ID,
  metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
};

/**
 * Picks the task definition to copy the container shape from: the framework's
 * own image in native mode, otherwise Taurus.
 *
 * A hub deployed before native mode has no native task definitions, so this
 * fails with an actionable message rather than letting the test start and
 * behave unexpectedly.
 */
function resolveTaskDefinition(event: TaskRunnerEvent): string {
  if (!event.nativeRunMode) {
    return event.hubTaskDefinition;
  }

  const framework = TEST_TYPE_TO_FRAMEWORK[event.testType];
  const taskDefinition = event.nativeTaskDefinitions[framework];
  if (!taskDefinition) {
    throw new Error(`Task definition not found for load test framework ${framework}.`);
  }
  return taskDefinition;
}

/**
 * Container settings that only apply to native mode.
 *
 * Native-mode tests run the load their uploaded script defines, so the only
 * setting is DLT's safety timeout. DLT does not pass any load parameters.
 */
function buildNativeEnvVars(nativeRunMode: NativeRunMode): Record<string, string> {
  return {
    MAX_DURATION_SECONDS: nativeRunMode.maxTestDurationSeconds.toString(),
  };
}

interface CreateDashboardParams {
  readonly nativeRunMode: NativeRunMode | null;
  readonly spokeClientConfig: ReturnType<typeof getAwsClientConfig>;
  readonly testId: string;
  readonly region: string;
  readonly ecsCloudWatchLogGroup: string;
  readonly taskCluster: string;
  readonly logger: Logger;
}

/**
 * Creates the CloudWatch metric filters and dashboard for live monitoring,
 * except in native mode.
 *
 * The metric filter and Logs Insights query both parse the space-delimited
 * Taurus console line (`{testId} live=true ... 10 vu\t140 succ\t...`). Native
 * containers emit JSON with no testId prefix, so nothing matches: every widget
 * renders empty and the metric filters sit inert on the log group.
 */
async function createDashboard(params: CreateDashboardParams): Promise<void> {
  const { nativeRunMode, spokeClientConfig, testId, region, ecsCloudWatchLogGroup, taskCluster, logger } = params;

  if (nativeRunMode) {
    logger.info("Skipping CloudWatch dashboard creation for native mode", { testId, region });
    return;
  }

  await createTaurusDashboard({
    cloudwatch: new CloudWatchClient(spokeClientConfig),
    cloudwatchLogs: new CloudWatchLogsClient({ ...spokeClientConfig, maxAttempts: 10 }),
    testId,
    region,
    ecsCloudWatchLogGroup,
    taskCluster,
    logger,
  });
}

/**
 * Task Runner Lambda handler.
 *
 * Creates the resources needed for a load test in one region:
 * 1. Registers a test-specific ECS task definition (cloned from base)
 * 2. Creates an ephemeral ECS service with the desired task count
 * 3. Creates CloudWatch metric filters and dashboard for live monitoring
 *
 * On success, returns a {@link TaskRunnerResult} that feeds into the step
 * function's stabilization loop. Does NOT poll for stabilization — that is
 * handled by the step function's Wait → Stabilization Checker → Choice pattern.
 *
 * On an expected setup failure, does NOT throw: it returns a FAILED
 * {@link ServiceStabilizationResult} carrying a classified `errorMessage`, so the
 * failing region flows into Regional Sync's aggregation and both the scenario and
 * the run's terminal `errorReason` reflect the same, specific cause. A fast
 * status-only DDB write still marks the scenario `failed` immediately. Only truly
 * unexpected Lambda-level errors propagate (caught by the step function).
 */
export async function handler(event: TaskRunnerEvent): Promise<TaskRunnerResult | ServiceStabilizationResult> {
  const { testId, testRunId, testType, fileType, showLive, testDuration, prefix, testTaskConfig, nativeRunMode } =
    event;
  const {
    region,
    taskCluster,
    taskCount,
    subnetA,
    subnetB,
    taskSecurityGroup,
    ecsCloudWatchLogGroup,
    taskRoleArn,
    executionRoleArn,
  } = testTaskConfig;

  const logger = createLogger({ serviceName: "task-runner", solutionId: SOLUTION_ID, version: VERSION });
  logger.appendKeys({ testId, testRunId, region });

  logger.info("Task runner invoked", { testType, taskCount, prefix });

  const spokeClientConfig = getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region });
  const spokeEcs = new ECSClient(spokeClientConfig);
  const hubEcs = new ECSClient(
    getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: MAIN_STACK_REGION })
  );

  try {
    // 1. Build environment variables for the test containers
    const envVars: Record<string, string> = {
      MAIN_STACK_REGION: MAIN_STACK_REGION,
      S3_BUCKET: SCENARIOS_BUCKET,
      TEST_ID: testId,
      TEST_RUN_ID: testRunId,
      TEST_TYPE: testType,
      FILE_TYPE: fileType,
      LIVE_DATA_ENABLED: `live=${showLive}`,
      TASK_COUNT: taskCount.toString(),
      PREFIX: prefix,
      SCRIPT: "ecslistener.py",
      TIMEOUT: "900",
      ...(nativeRunMode ? buildNativeEnvVars(nativeRunMode) : {}),
    };

    // 2. Register test-specific task definition.
    // Container shape (image, cpu, memory, healthCheck, etc.) comes from the hub's
    // task definition. Roles and log configuration come from the spoke's DynamoDB config.
    const taskDefResult = await createTestTaskDefinition({
      hubEcs,
      spokeEcs,
      hubTaskDefinition: resolveTaskDefinition(event),
      taskRoleArn,
      executionRoleArn,
      ecsCloudWatchLogGroup,
      region,
      testId,
      testRunId,
      envVars,
      solutionId: SOLUTION_ID,
      logger,
    });

    // 3. Create ephemeral ECS service
    const serviceName = buildServiceName(testId, region);
    const serviceResult = await createEcsService({
      ecs: spokeEcs,
      cluster: taskCluster,
      serviceName,
      taskDefinitionArn: taskDefResult.taskDefinitionArn,
      desiredCount: taskCount,
      subnets: [subnetA, subnetB],
      securityGroup: taskSecurityGroup,
      testId,
      testRunId,
      solutionId: SOLUTION_ID,
      logger,
    });

    logger.info("ECS service created", {
      logEvent: LogEvent.SERVICE_CREATED,
      serviceName: serviceResult.serviceName,
      desiredCount: taskCount,
    });

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.ServiceCreated,
      TestId: testId,
      TestRunId: testRunId,
      Region: region,
      ServiceName: serviceResult.serviceName,
      DesiredCount: taskCount,
    });

    // 4. Transition DDB status from "queued" to "provisioning" now that
    // the ECS service exists. The step function's stabilization loop
    // checks health before the Start Command promotes to "running".
    const ddb = DynamoDBDocumentClient.from(
      new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }))
    );
    await ddb.send(
      new UpdateCommand({
        TableName: SCENARIOS_TABLE,
        Key: { testId },
        UpdateExpression: "SET #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": TestStatus.PROVISIONING },
      })
    );
    logger.info("Updated test status to provisioning");

    // 5. Create CloudWatch dashboard for live monitoring (skipped in native mode)
    await createDashboard({
      nativeRunMode,
      spokeClientConfig,
      testId,
      region,
      ecsCloudWatchLogGroup,
      taskCluster,
      logger,
    });

    // 6. Return TaskRunnerResult — stabilization checked by step function
    return {
      testId,
      testRunId,
      testType,
      fileType,
      showLive,
      testDuration,
      prefix,
      nativeRunMode,
      testTaskConfig,
      serviceName: serviceResult.serviceName,
      serviceArn: serviceResult.serviceArn,
      taskDefinitionArn: taskDefResult.taskDefinitionArn,
      taskDefinitionFamily: taskDefResult.family,
      desiredCount: taskCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Task runner failed", { logEvent: LogEvent.TASK_RUNNER_FAILED, error: message });

    // Classify the failure into a curated, actionable reason for the UI
    // (draining, capacity, quota, throttling, networking, or a safe generic
    // fallback). The raw error stays in the log above and the metric below; only
    // the non-leaky catalog message is surfaced.
    const errorReason = getSetupErrorReason(error);

    await sendOperationalMetric(metricEnvelope, {
      Type: OperationalMetricEvent.ServiceCreateFailed,
      TestId: testId,
      TestRunId: testRunId,
      Region: region,
      Error: message,
    });

    // Fast, status-only fail signal: mark the scenario `failed` immediately so
    // the UI reflects the failure without waiting for the step function to finish
    // stabilizing sibling regions and cleaning up. The reason is intentionally
    // NOT written here — errorReason has a single writer (the terminal step
    // function write, composed by Regional Sync from every region's cause), so
    // the scenario and run records stay consistent.
    //
    // Defense-in-depth: a service-creation failure can only happen while this run
    // is still starting up, so the record should be "queued" (set by the API) or
    // "provisioning" (set by a sibling region of this same run). The conditional
    // write only marks the scenario failed in those states; if it has advanced to
    // running/parsing/cleaning up/complete, that lifecycle belongs to a different,
    // healthy run — the write is skipped rather than clobbering it.
    try {
      const ddb = DynamoDBDocumentClient.from(
        new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }))
      );
      await ddb.send(
        new UpdateCommand({
          TableName: SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: "SET #s = :failed",
          ConditionExpression: "attribute_not_exists(#s) OR #s IN (:queued, :provisioning)",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":failed": TestStatus.FAILED,
            ":queued": TestStatus.QUEUED,
            ":provisioning": TestStatus.PROVISIONING,
          },
        })
      );
    } catch (ddbError: unknown) {
      if (ddbError instanceof ConditionalCheckFailedException) {
        logger.warn("Skipped failure status write; scenario is owned by a different active run", {
          logEvent: LogEvent.TASK_RUNNER_FAILED,
          testId,
          testRunId,
        });
      } else {
        const ddbMessage = ddbError instanceof Error ? ddbError.message : String(ddbError);
        logger.error("Failed to update DynamoDB status", { error: ddbMessage });
      }
    }

    // Return a FAILED region result (instead of throwing) so this region flows
    // into Regional Sync carrying its specific errorMessage. The resource fields
    // are placeholders — creation failed before they existed — except serviceName,
    // which is deterministic and lets downstream cleanup target the right service.
    return {
      testId,
      testRunId,
      testType,
      fileType,
      showLive,
      testDuration,
      prefix,
      nativeRunMode,
      testTaskConfig,
      status: StabilizationStatus.FAILED,
      errorMessage: errorReason,
      serviceName: buildServiceName(testId, region),
      serviceArn: "",
      taskDefinitionArn: "",
      taskDefinitionFamily: "",
      desiredCount: taskCount,
      runningCount: 0,
      stabilizationStartTime: 0,
      readyTimestamp: 0,
    };
  }
}
