// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ServiceStabilizationResult } from "@amzn/dlt-common";
import { StabilizationStatus } from "@amzn/dlt-common";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/sync.js", () => ({
  validateRegions: vi.fn(),
}));
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(),
}));

const mockDdbSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDdbSend })) },
  UpdateCommand: vi.fn(),
}));

vi.mock("@amzn/dlt-common", () => ({
  StabilizationStatus: { READY: "READY", PENDING: "PENDING", FAILED: "FAILED" },
  LogEvent: { REGIONAL_SYNC_COMPLETE: "REGIONAL_SYNC_COMPLETE" },
  OPERATIONAL_METRIC_EVENT_VERSION: "1",
  OperationalMetricEvent: { RegionsReady: "RegionsReady" },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendKeys: vi.fn(),
  })),
  getAwsClientConfig: vi.fn(() => ({})),
  getRequiredEnv: vi.fn((name: string) => {
    const envMap: Record<string, string> = {
      SOLUTION_ID: "SO0062",
      VERSION: "0.0.0",
      UUID: "test-uuid",
      METRIC_URL: "https://metrics.example.com/endpoint",
      SCENARIOS_TABLE: "test-scenarios-table",
      AWS_ACCOUNT_ID: "123456789012",
    };
    return envMap[name] ?? `mock-${name}`;
  }),
  sendOperationalMetric: vi.fn(),
}));

import { sendOperationalMetric } from "@amzn/dlt-common";
import { handler } from "../src/index.js";
import { validateRegions } from "../src/sync.js";

const mockValidateRegions = vi.mocked(validateRegions);
const mockSendOperationalMetric = vi.mocked(sendOperationalMetric);

function makeRegion(region: string, status: StabilizationStatus, readyTimestamp = 0): ServiceStabilizationResult {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testType: "simple",
    fileType: "none",
    showLive: true,
    testDuration: 300,
    prefix: "2025-01-01T00-00-00_abc",
    testTaskConfig: {
      region,
      taskCluster: `dlt-cluster-${region}`,
      taskCount: 5,
      subnetA: "subnet-aaa",
      subnetB: "subnet-bbb",
      taskSecurityGroup: "sg-123",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskRoleArn: `arn:aws:iam::123456789:role/dlt-task-role-${region}`,
      executionRoleArn: `arn:aws:iam::123456789:role/dlt-execution-role-${region}`,
    },
    status,
    stabilizationStartTime: 1000000,
    serviceName: `dlt-test-abc123-${region}`,
    serviceArn: `arn:aws:ecs:${region}:123456789:service/dlt-cluster/dlt-test-abc123-${region}`,
    taskDefinitionArn: `arn:aws:ecs:${region}:123456789:task-definition/dlt-worker-test-abc123:1`,
    taskDefinitionFamily: "dlt-worker-test-abc123",
    desiredCount: 5,
    runningCount: status === StabilizationStatus.READY ? 5 : 0,
    readyTimestamp,
  };
}

function makeEvent(regions: ServiceStabilizationResult[]) {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testType: "simple" as const,
    regions,
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
  });

  it("should return the result from validateRegions when all regions are ready", async () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.READY, 2000),
    ];
    const syncResult = { allReady: true, syncDelay: 1000, regions };

    mockValidateRegions.mockReturnValue(syncResult);

    const result = await handler(makeEvent(regions));

    expect(result).toEqual(syncResult);
    expect(mockValidateRegions).toHaveBeenCalledWith(regions);
  });

  it("should return the result with failedRegions when a region failed", async () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.FAILED),
    ];
    const syncResult = {
      allReady: false,
      syncDelay: 0,
      regions,
      failedRegions: ["eu-west-1"],
    };

    mockValidateRegions.mockReturnValue(syncResult);

    const result = await handler(makeEvent(regions));

    expect(result.allReady).toBe(false);
    expect(result.failedRegions).toEqual(["eu-west-1"]);
  });

  it("should call sendOperationalMetric with correct envelope and data including testRunId", async () => {
    const regions = [makeRegion("us-east-1", StabilizationStatus.READY, 1000)];
    mockValidateRegions.mockReturnValue({ allReady: true, syncDelay: 0, regions });

    await handler(makeEvent(regions));

    expect(mockSendOperationalMetric).toHaveBeenCalledWith(
      {
        solutionId: "SO0062",
        uuid: "test-uuid",
        version: "0.0.0",
        metricUrl: "https://metrics.example.com/endpoint",
        accountId: "123456789012",
        metricSchemaVersion: "1",
      },
      {
        Type: "RegionsReady",
        TestId: "test-abc123",
        TestRunId: "run-001",
        AllReady: true,
        SyncDelay: 0,
        RegionCount: 1,
      }
    );
  });

  it("should not throw when sendOperationalMetric fails", async () => {
    const regions = [makeRegion("us-east-1", StabilizationStatus.READY, 1000)];
    mockValidateRegions.mockReturnValue({ allReady: true, syncDelay: 0, regions });
    mockSendOperationalMetric.mockResolvedValue(undefined);

    await expect(handler(makeEvent(regions))).resolves.toBeDefined();
  });

  it("should update DDB status to failed when validateRegions throws", async () => {
    const regions = [makeRegion("us-east-1", StabilizationStatus.READY, 1000)];

    mockValidateRegions.mockImplementation(() => {
      throw new Error("Validation failed");
    });

    await expect(handler(makeEvent(regions))).rejects.toThrow("Validation failed");

    expect(mockDdbSend).toHaveBeenCalledOnce();
  });

  it("should re-throw the original error even if DDB update fails", async () => {
    const regions = [makeRegion("us-east-1", StabilizationStatus.READY, 1000)];
    mockDdbSend.mockRejectedValueOnce(new Error("DDB error"));

    mockValidateRegions.mockImplementation(() => {
      throw new Error("Original error");
    });

    await expect(handler(makeEvent(regions))).rejects.toThrow("Original error");
  });
});
