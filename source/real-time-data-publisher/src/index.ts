// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
import { createLogger, getAwsClientConfig, getRequiredEnv } from "@amzn/dlt-common";

const gunzipAsync = promisify(gunzip);

const AWS_REGION = getRequiredEnv("AWS_REGION");
const MAIN_REGION = getRequiredEnv("MAIN_REGION");
const IOT_ENDPOINT = getRequiredEnv("IOT_ENDPOINT");
const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");

const iot = new IoTDataPlaneClient({
  ...getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: MAIN_REGION }),
  endpoint: IOT_ENDPOINT,
});

const logger = createLogger({ serviceName: "real-time-data-publisher", solutionId: SOLUTION_ID, version: VERSION });

interface CloudWatchLogsEvent {
  awslogs: { data: string };
}

interface LogEvent {
  id: string;
  timestamp: number;
  message: string;
}

interface DecodedPayload {
  messageType: string;
  owner: string;
  logGroup: string;
  logStream: string;
  subscriptionFilters: string[];
  logEvents: LogEvent[];
}

interface TestMetric {
  testId: string;
  vu: number;
  succ: number;
  fail: number;
  avgRt: number;
  timestamp: number;
}

const TEST_ID_PATTERN = /^(\w+)/;
const VU_PATTERN = /(\d{1,6})\s+vu/;
const SUCC_PATTERN = /(\d{1,6})\s+succ/;
const FAIL_PATTERN = /(\d{1,6})\s+fail/;
const AVG_RT_PATTERN = /(\d{1,3}(?:\.\d{1,3})?)\s+avg rt/;

function extractMetric(message: string, timestamp: number): TestMetric | undefined {
  const testIdMatch = TEST_ID_PATTERN.exec(message);
  const vuMatch = VU_PATTERN.exec(message);
  const succMatch = SUCC_PATTERN.exec(message);
  const failMatch = FAIL_PATTERN.exec(message);
  const avgRtMatch = AVG_RT_PATTERN.exec(message);

  if (!testIdMatch?.[1] || !vuMatch?.[1] || !succMatch?.[1] || !failMatch?.[1] || !avgRtMatch?.[1]) {
    return undefined;
  }

  return {
    testId: testIdMatch[1],
    vu: parseInt(vuMatch[1], 10),
    succ: parseInt(succMatch[1], 10),
    fail: parseInt(failMatch[1], 10),
    avgRt: parseFloat(avgRtMatch[1]),
    timestamp: Math.round(timestamp / 1000) * 1000,
  };
}

export async function handler(event: CloudWatchLogsEvent): Promise<void> {
  const payload = Buffer.from(event.awslogs.data, "base64");

  const decompressed = await gunzipAsync(payload);
  const decoded = JSON.parse(decompressed.toString("utf-8")) as DecodedPayload;

  logger.info("Processing log events for real-time data", { count: decoded.logEvents.length });

  const region = AWS_REGION;
  const metrics: TestMetric[] = [];
  let testId = "";

  for (const logEvent of decoded.logEvents) {
    const metric = extractMetric(logEvent.message, logEvent.timestamp);
    if (!metric) continue;

    testId = testId || metric.testId;
    metrics.push(metric);
  }

  if (metrics.length === 0) {
    logger.info("No metrics extracted from log events");
    return;
  }

  const topic = `dlt/${testId}`;
  await iot.send(
    new PublishCommand({
      topic,
      payload: Buffer.from(JSON.stringify({ [region]: metrics })),
    })
  );

  logger.info("Published real-time data", { topic, metricCount: metrics.length });
}
