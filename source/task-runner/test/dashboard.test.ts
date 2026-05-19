// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { PutDashboardCommandInput, PutMetricDataCommandInput } from "@aws-sdk/client-cloudwatch";
import type { PutMetricFilterCommandInput } from "@aws-sdk/client-cloudwatch-logs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboard, publishMetricFilterCount } from "../src/dashboard.js";

const mockCwSend = vi.fn<(command: { input: unknown }) => Promise<unknown>>();
const mockCwlSend = vi.fn<(command: { input: unknown }) => Promise<unknown>>();

const mockCloudwatch = { send: mockCwSend } as unknown as import("@aws-sdk/client-cloudwatch").CloudWatchClient;
const mockCloudwatchLogs = {
  send: mockCwlSend,
} as unknown as import("@aws-sdk/client-cloudwatch-logs").CloudWatchLogsClient;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
};

/** Helper to extract command input from a mock's call history. */
function cwCallInput(callIndex: number): unknown {
  const call = mockCwSend.mock.calls[callIndex];
  if (!call) throw new Error(`Expected mockCwSend call at index ${callIndex}`);
  return call[0].input;
}

function cwlCallInput(callIndex: number): unknown {
  const call = mockCwlSend.mock.calls[callIndex];
  if (!call) throw new Error(`Expected mockCwlSend call at index ${callIndex}`);
  return call[0].input;
}

describe("createDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // PutMetricFilter calls (4 metrics) + DescribeMetricFilters + PutMetricData
    mockCwlSend.mockResolvedValue({ metricFilters: [], nextToken: undefined });
    mockCwSend.mockResolvedValue({});
  });

  it("should create 4 metric filters and a dashboard", async () => {
    await createDashboard({
      cloudwatch: mockCloudwatch,
      cloudwatchLogs: mockCloudwatchLogs,
      testId: "test-abc123",
      region: "us-east-1",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskCluster: "dlt-cluster",
      logger: mockLogger as never,
    });

    // 4 PutMetricFilter calls + 1 DescribeMetricFilters (from publishMetricFilterCount)
    expect(mockCwlSend).toHaveBeenCalledTimes(5);

    // 1 PutDashboard + 1 PutMetricData (from publishMetricFilterCount)
    expect(mockCwSend).toHaveBeenCalledTimes(2);

    // Verify PutDashboard was called with correct name
    const putDashboardInput = cwCallInput(0) as PutDashboardCommandInput;
    expect(putDashboardInput.DashboardName).toBe("EcsLoadTesting-test-abc123-us-east-1");

    // Verify dashboard body contains 4 widgets
    const dashboardBody = JSON.parse(putDashboardInput.DashboardBody ?? "{}") as { widgets: unknown[] };
    expect(dashboardBody.widgets).toHaveLength(4);
  });

  it("should create metric filters with correct filter patterns", async () => {
    await createDashboard({
      cloudwatch: mockCloudwatch,
      cloudwatchLogs: mockCloudwatchLogs,
      testId: "test-abc123",
      region: "us-east-1",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskCluster: "dlt-cluster",
      logger: mockLogger as never,
    });

    // Check first metric filter (numVu)
    const firstInput = cwlCallInput(0) as PutMetricFilterCommandInput;
    expect(firstInput.filterName).toBe("dlt-cluster-EcsnumVu-test-abc123");
    expect(firstInput.logGroupName).toBe("/ecs/dlt-load-tester");
    expect(firstInput.filterPattern).toContain('testId="test-abc123"');
  });
});

describe("publishMetricFilterCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should count metric filters and publish the count", async () => {
    mockCwlSend.mockResolvedValueOnce({
      metricFilters: [{}, {}, {}],
      nextToken: undefined,
    });
    mockCwSend.mockResolvedValueOnce({});

    await publishMetricFilterCount({
      cloudwatch: mockCloudwatch,
      cloudwatchLogs: mockCloudwatchLogs,
      logGroupName: "/ecs/dlt-load-tester",
      logger: mockLogger as never,
    });

    // Verify PutMetricData was called with correct count
    const putMetricInput = cwCallInput(0) as PutMetricDataCommandInput;
    expect(putMetricInput.Namespace).toBe("distributed-load-testing");
    expect(putMetricInput.MetricData?.[0]?.MetricName).toBe("MetricFilterCount");
    expect(putMetricInput.MetricData?.[0]?.Value).toBe(3);
  });

  it("should paginate through all metric filters", async () => {
    mockCwlSend
      .mockResolvedValueOnce({
        metricFilters: [{}, {}],
        nextToken: "token-1",
      })
      .mockResolvedValueOnce({
        metricFilters: [{}],
        nextToken: undefined,
      });
    mockCwSend.mockResolvedValueOnce({});

    await publishMetricFilterCount({
      cloudwatch: mockCloudwatch,
      cloudwatchLogs: mockCloudwatchLogs,
      logGroupName: "/ecs/dlt-load-tester",
      logger: mockLogger as never,
    });

    expect(mockCwlSend).toHaveBeenCalledTimes(2);
    const putMetricInput = cwCallInput(0) as PutMetricDataCommandInput;
    expect(putMetricInput.MetricData?.[0]?.Value).toBe(3);
  });

  it("should warn but not throw on failure", async () => {
    mockCwlSend.mockRejectedValueOnce(new Error("Access denied"));

    await publishMetricFilterCount({
      cloudwatch: mockCloudwatch,
      cloudwatchLogs: mockCloudwatchLogs,
      logGroupName: "/ecs/dlt-load-tester",
      logger: mockLogger as never,
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Failed to publish metric filter count",
      expect.objectContaining({ error: "Access denied" })
    );
  });
});
