// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from "@aws-sdk/client-cloudwatch";
import {
    CloudWatchLogsClient,
    DeleteMetricFilterCommand,
    DescribeMetricFiltersCommand,
    ResourceNotFoundException,
} from "@aws-sdk/client-cloudwatch-logs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteMetricFilters, publishMetricFilterCount } from "../src/metric-cleanup.js";

const cwLogsMock = mockClient(CloudWatchLogsClient);
const cwMock = mockClient(CloudWatchClient);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendKeys: vi.fn(),
  };
}

describe("deleteMetricFilters", () => {
  beforeEach(() => {
    cwLogsMock.reset();
  });

  it("should delete all four metric filters", async () => {
    cwLogsMock.on(DeleteMetricFilterCommand).resolves({});

    await deleteMetricFilters({
      cloudwatchLogs: new CloudWatchLogsClient({}),
      testId: "test-abc123",
      taskCluster: "dlt-cluster",
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: makeLogger() as never,
    });

    const calls = cwLogsMock.commandCalls(DeleteMetricFilterCommand);
    expect(calls).toHaveLength(4);

    const filterNames = calls.map((c) => c.args[0].input.filterName);
    expect(filterNames).toEqual([
      "dlt-cluster-EcsnumVu-test-abc123",
      "dlt-cluster-EcsnumSucc-test-abc123",
      "dlt-cluster-EcsnumFail-test-abc123",
      "dlt-cluster-EcsavgRt-test-abc123",
    ]);

    // All use the correct log group
    for (const call of calls) {
      expect(call.args[0].input.logGroupName).toBe("/ecs/dlt");
    }
  });

  it("should handle ResourceNotFoundException gracefully and continue", async () => {
    cwLogsMock
      .on(DeleteMetricFilterCommand)
      .resolvesOnce({})
      .rejectsOnce(new ResourceNotFoundException({ message: "not found", $metadata: {} }))
      .resolvesOnce({})
      .resolvesOnce({});

    await deleteMetricFilters({
      cloudwatchLogs: new CloudWatchLogsClient({}),
      testId: "test-abc123",
      taskCluster: "dlt-cluster",
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: makeLogger() as never,
    });

    // All four attempted
    expect(cwLogsMock.commandCalls(DeleteMetricFilterCommand)).toHaveLength(4);
  });

  it("should log warning for non-ResourceNotFoundException errors and continue", async () => {
    const logger = makeLogger();
    cwLogsMock
      .on(DeleteMetricFilterCommand)
      .resolvesOnce({})
      .rejectsOnce(new Error("Throttled"))
      .resolvesOnce({})
      .resolvesOnce({});

    await deleteMetricFilters({
      cloudwatchLogs: new CloudWatchLogsClient({}),
      testId: "test-abc123",
      taskCluster: "dlt-cluster",
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: logger as never,
    });

    // All four attempted despite error
    expect(cwLogsMock.commandCalls(DeleteMetricFilterCommand)).toHaveLength(4);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("publishMetricFilterCount", () => {
  beforeEach(() => {
    cwLogsMock.reset();
    cwMock.reset();
  });

  it("should count metric filters and publish the count", async () => {
    cwLogsMock.on(DescribeMetricFiltersCommand).resolves({
      metricFilters: [{ filterName: "f1" }, { filterName: "f2" }, { filterName: "f3" }],
    });
    cwMock.on(PutMetricDataCommand).resolves({});

    await publishMetricFilterCount({
      cloudwatch: new CloudWatchClient({}),
      cloudwatchLogs: new CloudWatchLogsClient({}),
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: makeLogger() as never,
    });

    const putCall = cwMock.commandCalls(PutMetricDataCommand)[0];
    expect(putCall?.args[0].input).toMatchObject({
      Namespace: "distributed-load-testing",
      MetricData: [
        {
          MetricName: "MetricFilterCount",
          Value: 3,
          Unit: StandardUnit.Count,
          Dimensions: [{ Name: "LogGroupName", Value: "/ecs/dlt" }],
        },
      ],
    });
  });

  it("should handle paginated metric filter responses", async () => {
    cwLogsMock
      .on(DescribeMetricFiltersCommand)
      .resolvesOnce({
        metricFilters: [{ filterName: "f1" }, { filterName: "f2" }],
        nextToken: "token1",
      })
      .resolvesOnce({
        metricFilters: [{ filterName: "f3" }],
      });
    cwMock.on(PutMetricDataCommand).resolves({});

    await publishMetricFilterCount({
      cloudwatch: new CloudWatchClient({}),
      cloudwatchLogs: new CloudWatchLogsClient({}),
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: makeLogger() as never,
    });

    const putCall = cwMock.commandCalls(PutMetricDataCommand)[0];
    expect(putCall?.args[0].input.MetricData?.[0]?.Value).toBe(3);
  });

  it("should publish zero when no metric filters exist", async () => {
    cwLogsMock.on(DescribeMetricFiltersCommand).resolves({ metricFilters: [] });
    cwMock.on(PutMetricDataCommand).resolves({});

    await publishMetricFilterCount({
      cloudwatch: new CloudWatchClient({}),
      cloudwatchLogs: new CloudWatchLogsClient({}),
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: makeLogger() as never,
    });

    const putCall = cwMock.commandCalls(PutMetricDataCommand)[0];
    expect(putCall?.args[0].input.MetricData?.[0]?.Value).toBe(0);
  });

  it("should not throw when describe fails — logs warning instead", async () => {
    const logger = makeLogger();
    cwLogsMock.on(DescribeMetricFiltersCommand).rejects(new Error("Access denied"));

    await publishMetricFilterCount({
      cloudwatch: new CloudWatchClient({}),
      cloudwatchLogs: new CloudWatchLogsClient({}),
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: logger as never,
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(cwMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
  });

  it("should not throw when putMetricData fails — logs warning instead", async () => {
    const logger = makeLogger();
    cwLogsMock.on(DescribeMetricFiltersCommand).resolves({ metricFilters: [{ filterName: "f1" }] });
    cwMock.on(PutMetricDataCommand).rejects(new Error("Throttled"));

    await publishMetricFilterCount({
      cloudwatch: new CloudWatchClient({}),
      cloudwatchLogs: new CloudWatchLogsClient({}),
      ecsCloudWatchLogGroup: "/ecs/dlt",
      logger: logger as never,
    });

    expect(logger.warn).toHaveBeenCalled();
  });
});
