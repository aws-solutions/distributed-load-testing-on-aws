// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { OperationalMetricEnvelope, TestTaskRegionConfig } from "@amzn/dlt-common";
import {
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LogEvent,
  OPERATIONAL_METRIC_EVENT_VERSION,
  OperationalMetricEvent,
  sendOperationalMetric,
} from "@amzn/dlt-common";
import { S3Client } from "@aws-sdk/client-s3";

import type { StartCommandResult } from "./start-command.js";
import { writeStartMarker } from "./start-command.js";

/**
 * Event shape passed by the step function execution phase.
 *
 * The Start Command Lambda writes an S3 start marker for the region.
 * Each ECS task in the region polls for this marker using S3 HEAD and
 * begins test execution when the marker is found.
 */
export interface StartCommandEvent {
  readonly testId: string;
  readonly testRunId: string;
  readonly prefix: string;
  readonly testTaskConfig: TestTaskRegionConfig;
  readonly serviceName: string;
  readonly serviceArn: string;
}

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const UUID = getRequiredEnv("UUID");
const METRIC_URL = getRequiredEnv("METRIC_URL");
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
 * Start Command Lambda handler.
 *
 * Writes an S3 start marker for the region so that all ECS tasks in
 * that region can detect it via HEAD polling and begin test execution.
 * The scenarios bucket is in the main stack region — containers in any
 * region can reach it via cross-region S3 requests.
 */
export async function handler(event: StartCommandEvent): Promise<StartCommandResult> {
  const { testId, testRunId, prefix, testTaskConfig } = event;
  const { region } = testTaskConfig;

  const logger = createLogger({ serviceName: "start-command", solutionId: SOLUTION_ID, version: VERSION });
  logger.appendKeys({ testId, testRunId, region });

  logger.info("Start command invoked", {
    logEvent: LogEvent.START_COMMAND_INVOKED,
    serviceName: event.serviceName,
  });

  const s3 = new S3Client(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: MAIN_STACK_REGION }));

  const result = await writeStartMarker({
    s3,
    bucket: SCENARIOS_BUCKET,
    testId,
    prefix,
    region,
    logger,
  });

  logger.info("Start command complete", {
    logEvent: LogEvent.START_COMMAND_COMPLETE,
    s3Key: result.s3Key,
  });

  await sendOperationalMetric(metricEnvelope, {
    Type: OperationalMetricEvent.StartCommandSent,
    TestId: testId,
    TestRunId: testRunId,
    Region: region,
  });

  return result;
}
