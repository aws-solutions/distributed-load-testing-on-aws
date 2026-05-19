// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TestCleanupEvent } from "@amzn/dlt-common";
import { TestStatus } from "@amzn/dlt-common";

// Mock all dependency modules before importing handler
vi.mock("../src/service-cleanup.js", () => ({
  drainAndDeleteService: vi.fn(),
}));
vi.mock("../src/task-definition-cleanup.js", () => ({
  cleanupTaskDefinitions: vi.fn(),
}));
vi.mock("../src/metric-cleanup.js", () => ({
  deleteMetricFilters: vi.fn(),
  publishMetricFilterCount: vi.fn(),
}));
vi.mock("@amzn/dlt-common", async () => {
  const actual = await vi.importActual<typeof import("@amzn/dlt-common")>("@amzn/dlt-common");
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      appendKeys: vi.fn(),
    })),
    getAwsClientConfig: vi.fn(() => ({ region: "us-east-1" })),
    getRequiredEnv: vi.fn((name: string) => {
      const envMap: Record<string, string> = {
        SOLUTION_ID: "SO0062",
        VERSION: "0.0.0",
        UUID: "test-uuid",
        METRIC_URL: "https://metrics.example.com",
        SCENARIOS_TABLE: "dlt-scenarios",
        HISTORY_TABLE: "dlt-history",
        AWS_ACCOUNT_ID: "123456789012",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
    sendOperationalMetric: vi.fn(),
  };
});
vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: vi.fn(),
}));
vi.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  CloudWatchLogsClient: vi.fn(),
}));
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(),
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    override readonly name = "ConditionalCheckFailedException";
  },
}));
vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn(),
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn().mockResolvedValue({
    Attributes: { scheduleTimezone: "UTC" }
  }) })) },
  UpdateCommand: vi.fn(),
  PutCommand: vi.fn(),
}));

import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { handler } from "../src/index.js";
import { deleteMetricFilters, publishMetricFilterCount } from "../src/metric-cleanup.js";
import { drainAndDeleteService } from "../src/service-cleanup.js";
import { cleanupTaskDefinitions } from "../src/task-definition-cleanup.js";

const mockDrain = vi.mocked(drainAndDeleteService);
const mockCleanupTaskDefs = vi.mocked(cleanupTaskDefinitions);
const mockDeleteFilters = vi.mocked(deleteMetricFilters);
const mockPublishCount = vi.mocked(publishMetricFilterCount);

function makeEvent(overrides?: Partial<TestCleanupEvent>): TestCleanupEvent {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testTaskConfig: {
      region: "us-east-1",
      taskCluster: "dlt-cluster",
      taskCount: 10,
      subnetA: "subnet-aaa",
      subnetB: "subnet-bbb",
      taskSecurityGroup: "sg-123",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role",
      executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role",
    },
    finalStatus: TestStatus.COMPLETE,
    ...overrides,
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrain.mockResolvedValue(undefined);
    mockCleanupTaskDefs.mockResolvedValue(undefined);
    mockDeleteFilters.mockResolvedValue(undefined);
    mockPublishCount.mockResolvedValue(undefined);
  });

  it("should call all cleanup functions and return success for finalStatus COMPLETE", async () => {
    const result = await handler(makeEvent());

    expect(result).toBe("cleanup complete — complete");
    expect(mockDrain).toHaveBeenCalledOnce();
    expect(mockCleanupTaskDefs).toHaveBeenCalledOnce();
    expect(mockDeleteFilters).toHaveBeenCalledOnce();
    expect(mockPublishCount).toHaveBeenCalledOnce();
  });

  it("should return failure message for finalStatus FAILED", async () => {
    const result = await handler(makeEvent({ finalStatus: TestStatus.FAILED, errorReason: "Timeout" }));

    expect(result).toBe("cleanup complete — test failed");
  });

  it("should return cancelled message for finalStatus CANCELLED", async () => {
    const result = await handler(makeEvent({ finalStatus: TestStatus.CANCELLED }));

    expect(result).toBe("cleanup complete — cancelled");
  });

  it("should pass correct params to drainAndDeleteService", async () => {
    await handler(makeEvent());

    const call = mockDrain.mock.calls[0];
    if (!call) throw new Error("Expected drainAndDeleteService call");
    expect(call[0]).toMatchObject({
      cluster: "dlt-cluster",
      serviceName: "dlt-test-abc123-us-east-1",
    });
  });

  it("should pass correct params to cleanupTaskDefinitions", async () => {
    await handler(makeEvent());

    const call = mockCleanupTaskDefs.mock.calls[0];
    if (!call) throw new Error("Expected cleanupTaskDefinitions call");
    expect(call[0]).toMatchObject({
      family: "dlt-worker-test-abc123",
    });
  });

  it("should pass correct params to deleteMetricFilters", async () => {
    await handler(makeEvent());

    const call = mockDeleteFilters.mock.calls[0];
    if (!call) throw new Error("Expected deleteMetricFilters call");
    expect(call[0]).toMatchObject({
      testId: "test-abc123",
      taskCluster: "dlt-cluster",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
    });
  });

  it("should write finalStatus directly to DDB with errorReason when provided", async () => {
    await handler(makeEvent({ finalStatus: TestStatus.FAILED, errorReason: "Circuit breaker triggered" }));

    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledTimes(2);
    
    const scenarioCallArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioCallArgs?.ExpressionAttributeValues).toHaveProperty(":s", "failed");
    expect(scenarioCallArgs?.ExpressionAttributeValues).toHaveProperty(":e", "Circuit breaker triggered");
    
    // Non-cancelled writes are blocked by all terminal states + cancelling
    expect(scenarioCallArgs?.ConditionExpression).toBe(
      "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled AND #s <> :failed AND #s <> :cancelling",
    );

    const historyCallArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyCallArgs?.ExpressionAttributeValues).toHaveProperty(":s", "failed");
  });

  it("should write finalStatus to DDB without errorReason when not provided", async () => {
    await handler(makeEvent({ finalStatus: TestStatus.COMPLETE }));

    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledTimes(2);

    const scenarioCallArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioCallArgs?.ExpressionAttributeValues).toHaveProperty(":s", "complete");
    expect(scenarioCallArgs?.ExpressionAttributeValues).not.toHaveProperty(":e");
    // Non-cancelled writes are blocked by all terminal states + cancelling
    expect(scenarioCallArgs?.ConditionExpression).toBe(
      "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled AND #s <> :failed AND #s <> :cancelling",
    );

    const historyCallArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyCallArgs?.ExpressionAttributeValues).toHaveProperty(":s", "complete");
    expect(historyCallArgs?.ConditionExpression).toBe(
      "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled AND #s <> :failed AND #s <> :cancelling",
    );
  });

  it("should allow cancelled to overwrite cancelling but not other terminal states", async () => {
    await handler(makeEvent({ finalStatus: TestStatus.CANCELLED }));

    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledTimes(2);

    const scenarioCallArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioCallArgs?.ExpressionAttributeValues).toHaveProperty(":s", "cancelled");
    expect(scenarioCallArgs?.ConditionExpression).toBe(
      "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled AND #s <> :failed"
    );
    expect(scenarioCallArgs?.ExpressionAttributeValues).not.toHaveProperty(":cancelling");

    const historyCallArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyCallArgs?.ExpressionAttributeValues).toHaveProperty(":s", "cancelled");
    expect(historyCallArgs?.ConditionExpression).toBe(
      "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled AND #s <> :failed"
    );
  });

  it("should derive serviceName from testId + region", async () => {
    await handler(makeEvent());

    const call = mockDrain.mock.calls[0];
    if (!call) throw new Error("Expected drainAndDeleteService call");
    // buildServiceName("test-abc123", "us-east-1") → "dlt-test-abc123-us-east-1"
    expect(call[0]).toMatchObject({
      serviceName: "dlt-test-abc123-us-east-1",
    });
  });

  it("should derive taskDefinitionFamily from testId", async () => {
    await handler(makeEvent());

    const call = mockCleanupTaskDefs.mock.calls[0];
    if (!call) throw new Error("Expected cleanupTaskDefinitions call");
    // buildTaskDefinitionFamily("test-abc123") → "dlt-worker-test-abc123"
    expect(call[0]).toMatchObject({
      family: "dlt-worker-test-abc123",
    });
  });

  it("should throw and update DDB to FAILED when drainAndDeleteService fails", async () => {
    mockDrain.mockRejectedValueOnce(new Error("ECS API error"));

    await expect(handler(makeEvent())).rejects.toThrow("ECS API error");
    // Best-effort DDB update should have been attempted
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledTimes(2);
  });

  it("should throw the original error even when best-effort DDB update also fails", async () => {
    const mockSend = vi.fn().mockRejectedValueOnce(new Error("DDB throttled"));
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockDrain.mockRejectedValueOnce(new Error("Service error"));

    await expect(handler(makeEvent())).rejects.toThrow("Service error");
  });

  it("should propagate errors from metric cleanup functions", async () => {
    mockDeleteFilters.mockRejectedValueOnce(new Error("CWLogs error"));

    await expect(handler(makeEvent())).rejects.toThrow("CWLogs error");
    // Service cleanup still happened before the failure
    expect(mockDrain).toHaveBeenCalledOnce();
    expect(mockCleanupTaskDefs).toHaveBeenCalledOnce();
  });

  it("should succeed silently when DDB status is already cancelled (ConditionalCheckFailedException)", async () => {
    const { ConditionalCheckFailedException } = await import("@aws-sdk/client-dynamodb");
    const mockSend = vi
      .fn()
      .mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: "Condition not met" }));
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    // When the SFN Failure Handler fires after the canceler has already set
    // status to "cancelled", or any other protected state, the ConditionExpression
    // fails. This must be a silent success — all cleanup functions still run.
    const result = await handler(makeEvent({ finalStatus: TestStatus.FAILED }));

    expect(result).toBe("cleanup complete — test failed");
    expect(mockDrain).toHaveBeenCalledOnce();
    expect(mockCleanupTaskDefs).toHaveBeenCalledOnce();
    expect(mockDeleteFilters).toHaveBeenCalledOnce();
    expect(mockPublishCount).toHaveBeenCalledOnce();
  });

  it("should write history entry when finalStatus is FAILED", async () => {
    const mockSend = vi.fn();
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    await handler(makeEvent({ finalStatus: TestStatus.FAILED, errorReason: "Threshold breached" }));

    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledTimes(2);

    const scenarioUpdateArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioUpdateArgs?.TableName).toBe("dlt-scenarios");
    expect(scenarioUpdateArgs?.Key).toHaveProperty("testId", "test-abc123");
    expect(scenarioUpdateArgs?.ExpressionAttributeValues).toHaveProperty(":s", "failed");

    const historyUpdateArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyUpdateArgs?.TableName).toBe("dlt-history");
    expect(historyUpdateArgs?.Key).toHaveProperty("testId", "test-abc123");
    expect(historyUpdateArgs?.Key).toHaveProperty("testRunId", "run-001");
    expect(historyUpdateArgs?.ExpressionAttributeValues).toHaveProperty(":s", "failed");
  });

  it("should skip history write silently on ConditionalCheckFailedException (dedup)", async () => {
    const { ConditionalCheckFailedException } = await import("@aws-sdk/client-dynamodb");
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({}) // updateTestStatus succeeds
      .mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: "exists" }));
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    const result = await handler(makeEvent({ finalStatus: TestStatus.FAILED, errorReason: "timeout" }));

    expect(result).toBe("cleanup complete — test failed");
  });

  it("should not fail cleanup when history write encounters an unexpected error", async () => {
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({}) // updateTestStatus succeeds
      .mockRejectedValueOnce(new Error("DDB throttled")); // history write fails
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    const result = await handler(makeEvent({ finalStatus: TestStatus.FAILED, errorReason: "timeout" }));

    expect(result).toBe("cleanup complete — test failed");
  });
});
