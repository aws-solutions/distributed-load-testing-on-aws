// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  createLogger,
  getAwsClientConfig,
  getRequiredEnv,
  LIVE_DATA_V1_SCHEMA,
  parseLiveDataPoint,
  parseTestIdFromLogStream,
  type LiveDataPoint,
} from "@amzn/dlt-common";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

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

// Matches the leading testId token of a Taurus-format live line. Aligned to the
// testId schema (^[a-zA-Z0-9-]+$) rather than \w so a hyphenated testId is
// captured in full — \w would truncate it at the first hyphen.
const TEST_ID_PATTERN = /^([a-zA-Z0-9-]+)/;
const VU_PATTERN = /(\d{1,6})\s+vu/;
const SUCC_PATTERN = /(\d{1,6})\s+succ/;
const FAIL_PATTERN = /(\d{1,6})\s+fail/;
const AVG_RT_PATTERN = /(\d{1,3}(?:\.\d{1,3})?)\s+avg rt/;

/**
 * Maps a native-mode live-data line onto the same metric shape the legacy
 * Taurus path produces.
 *
 * Key order matches extractMetric() exactly, because the payload is
 * JSON.stringify'd and the console reads both paths identically.
 */
function toTestMetric(point: LiveDataPoint): TestMetric {
  return {
    testId: point.testId,
    vu: point.vu,
    succ: point.succ,
    fail: point.fail,
    avgRt: point.avgRt,
    timestamp: point.timestamp,
  };
}

/**
 *
 * @param message
 * @param timestamp
 */
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
    vu: Number.parseInt(vuMatch[1], 10),
    succ: Number.parseInt(succMatch[1], 10),
    fail: Number.parseInt(failMatch[1], 10),
    avgRt: Number.parseFloat(avgRtMatch[1]),
    timestamp: Math.round(timestamp / 1000) * 1000,
  };
}

/**
 *
 * @param event
 */
export async function handler(event: CloudWatchLogsEvent): Promise<void> {
  // Create the logger per invocation (as every other DLT Lambda handler does)
  // so appended keys never leak across warm invocations — otherwise the
  // fail-closed log below could carry a previous invocation's testId.
  const logger = createLogger({ serviceName: "real-time-data-publisher", solutionId: SOLUTION_ID, version: VERSION });
  const region = AWS_REGION;
  logger.appendKeys({ region });

  const payload = Buffer.from(event.awslogs.data, "base64");
  const decompressed = await gunzipAsync(payload);
  const decoded = JSON.parse(decompressed.toString("utf-8")) as DecodedPayload;

  // The testId that owns this batch comes from the CloudWatch log stream name,
  // which the task-runner stamps with the testId (buildLiveDataStreamPrefix) and
  // which a container cannot forge — unlike the log line content, which a
  // customer script shares via stdio: "inherit". A subscription payload carries
  // exactly one log stream, so one stream == one ECS task == one test. Never
  // trust the testId embedded in a line for routing: a forged line could
  // otherwise publish to another test's topic.
  const streamTestId = parseTestIdFromLogStream(decoded.logStream);
  if (!streamTestId) {
    // Fail closed: without a trusted testId we cannot safely choose a topic.
    logger.error("Could not derive testId from log stream; skipping batch", {
      logStream: decoded.logStream,
    });
    return;
  }
  logger.appendKeys({ testId: streamTestId });

  logger.info("Processing log events for real-time data", { count: decoded.logEvents.length });
  const metrics: TestMetric[] = [];

  for (const logEvent of decoded.logEvents) {
    // Handle Native Mode events
    if (logEvent.message.includes(LIVE_DATA_V1_SCHEMA)) {
      const point = parseLiveDataPoint(logEvent.message);
      if (!point) {
        // Log error message but skip instead of throwing. This is best effort to
        // publish available data points.
        logger.error(`Skipping invalid ${LIVE_DATA_V1_SCHEMA} payload`, {
          logEventId: logEvent.id,
        });
        continue;
      }

      if (point.testId !== streamTestId) {
        // Forged or mislabeled line: its testId disagrees with the stream's
        // infrastructure-assigned testId. Drop it rather than route it to
        // another test's topic.
        logger.warn("Dropping live-data point whose testId disagrees with its log stream", {
          logEventId: logEvent.id,
          embeddedTestId: point.testId,
        });
        continue;
      }

      metrics.push(toTestMetric(point));
      continue;
    }

    // Fallback to legacy events
    const metric = extractMetric(logEvent.message, logEvent.timestamp);
    if (!metric) continue;

    if (metric.testId !== streamTestId) {
      logger.warn("Dropping legacy metric whose testId disagrees with its log stream", {
        logEventId: logEvent.id,
        embeddedTestId: metric.testId,
      });
      continue;
    }

    metrics.push(metric);
  }

  if (metrics.length === 0) {
    logger.info("No metrics extracted from log events");
    return;
  }

  const topic = `dlt/${streamTestId}`;
  await iot.send(
    new PublishCommand({
      topic,
      payload: Buffer.from(JSON.stringify({ [region]: metrics })),
    })
  );

  logger.info("Published real-time data", { topic, metricCount: metrics.length });
}
