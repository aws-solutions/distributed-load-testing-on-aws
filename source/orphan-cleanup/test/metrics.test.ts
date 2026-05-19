// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { METRICS_NAMESPACE, type Logger } from "@amzn/dlt-common";
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from "@aws-sdk/client-cloudwatch";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { METRIC_ORPHAN_CLEANUP_FAILURES, publishFailureCount } from "../src/metrics.js";

const cwMock = mockClient(CloudWatchClient);

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
} as unknown as Logger;

beforeEach(() => {
  cwMock.reset();
});

describe("publishFailureCount", () => {
  it("publishes failure count to CloudWatch", async () => {
    cwMock.on(PutMetricDataCommand).resolves({});

    await publishFailureCount(new CloudWatchClient({}), 3, logger);

    const call = cwMock.commandCalls(PutMetricDataCommand)[0];
    const input = call?.args[0].input;
    expect(input?.Namespace).toBe(METRICS_NAMESPACE);
    expect(input?.MetricData).toHaveLength(1);
    expect(input?.MetricData?.[0]?.MetricName).toBe(METRIC_ORPHAN_CLEANUP_FAILURES);
    expect(input?.MetricData?.[0]?.Value).toBe(3);
    expect(input?.MetricData?.[0]?.Unit).toBe(StandardUnit.Count);
  });

  it("publishes zero for successful cleanup", async () => {
    cwMock.on(PutMetricDataCommand).resolves({});

    await publishFailureCount(new CloudWatchClient({}), 0, logger);

    const call = cwMock.commandCalls(PutMetricDataCommand)[0];
    expect(call?.args[0].input.MetricData?.[0]?.Value).toBe(0);
  });

  it("does not throw when PutMetricData fails", async () => {
    cwMock.on(PutMetricDataCommand).rejects(new Error("CW failure"));

    await expect(publishFailureCount(new CloudWatchClient({}), 5, logger)).resolves.toBeUndefined();
  });
});
