// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

// Mock dependency modules before importing handler
vi.mock("../src/event-parser.js", () => ({
  extractTaskFailure: vi.fn(),
}));
vi.mock("../src/failure-tracking.js", () => ({
  incrementFailureCount: vi.fn(),
  isThresholdBreached: vi.fn(),
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
        AWS_ACCOUNT_ID: "123456789012",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
    sendOperationalMetric: vi.fn(),
  };
});
vi.mock(import("@aws-sdk/client-dynamodb"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DynamoDBClient: vi.fn(),
  };
});

const mockSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  UpdateCommand: vi.fn(),
}));

import type { FailureIncrementResult } from "../src/failure-tracking.js";

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type { ECSTaskStateChangeEvent } from "../src/event-parser.js";
import { extractTaskFailure } from "../src/event-parser.js";
import { incrementFailureCount, isThresholdBreached } from "../src/failure-tracking.js";
import { handler } from "../src/index.js";

const mockExtract = vi.mocked(extractTaskFailure);
const mockIncrement = vi.mocked(incrementFailureCount);
const mockThreshold = vi.mocked(isThresholdBreached);

function makeEvent(groupOverride?: string): ECSTaskStateChangeEvent {
  return {
    detail: {
      lastStatus: "STOPPED",
      group: groupOverride ?? "service:dlt-abc123-us-east-1",
      clusterArn: "arn:aws:ecs:us-east-1:123456789:cluster/dlt-cluster",
      taskArn: "arn:aws:ecs:us-east-1:123456789:task/dlt-cluster/task-1",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      containers: [{ exitCode: 1 }],
    },
  };
}

const defaultIncrementResult: FailureIncrementResult = {
  taskFailureCount: 3,
  desiredCount: 10,
  healthyThreshold: 90,
  status: "running",
  testRunId: "run-001",
};

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it("skips non-DLT events when extractTaskFailure returns undefined", async () => {
    mockExtract.mockReturnValue(undefined);

    await handler(makeEvent("family:some-other-service"));

    expect(mockIncrement).not.toHaveBeenCalled();
    expect(mockThreshold).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("records failure and skips status update when threshold is not breached", async () => {
    mockExtract.mockReturnValue({
      testId: "abc123",
      region: "us-east-1",
      taskArn: "arn:task-1",
      clusterArn: "arn:cluster-1",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      exitCode: 1,
    });
    mockIncrement.mockResolvedValue(defaultIncrementResult);
    mockThreshold.mockReturnValue(false);

    await handler(makeEvent());

    expect(mockIncrement).toHaveBeenCalledOnce();
    expect(mockThreshold).toHaveBeenCalledWith(3, 10, 90);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("updates DDB status to failed when threshold is breached", async () => {
    mockExtract.mockReturnValue({
      testId: "abc123",
      region: "us-east-1",
      taskArn: "arn:task-1",
      clusterArn: "arn:cluster-1",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      exitCode: 1,
    });
    mockIncrement.mockResolvedValue({ ...defaultIncrementResult, taskFailureCount: 5 });
    mockThreshold.mockReturnValue(true);

    await handler(makeEvent());

    expect(mockSend).toHaveBeenCalledOnce();
    const updateArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(updateArgs?.Key).toEqual({ testId: "abc123" });
    expect(updateArgs?.ExpressionAttributeValues).toMatchObject({
      ":s": "failed",
      ":running": "running",
    });
    expect(updateArgs?.ConditionExpression).toBe("attribute_exists(testId) AND #s = :running");
    expect(updateArgs?.ExpressionAttributeValues?.[":e"]).toContain("5/10 tasks failed");
  });

  it("skips threshold check when test is not in running state", async () => {
    mockExtract.mockReturnValue({
      testId: "abc123",
      region: "us-east-1",
      taskArn: "arn:task-1",
      clusterArn: "arn:cluster-1",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      exitCode: 1,
    });
    mockIncrement.mockResolvedValue({ ...defaultIncrementResult, status: "cancelling" });

    await handler(makeEvent());

    expect(mockThreshold).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("catches and logs errors without re-throwing (no retry storms)", async () => {
    mockExtract.mockReturnValue({
      testId: "abc123",
      region: "us-east-1",
      taskArn: "arn:task-1",
      clusterArn: "arn:cluster-1",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      exitCode: 1,
    });
    mockIncrement.mockRejectedValue(new Error("DDB throttled"));

    // Should NOT throw
    await handler(makeEvent());

    expect(mockThreshold).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("catches DDB status update errors without re-throwing", async () => {
    mockExtract.mockReturnValue({
      testId: "abc123",
      region: "us-east-1",
      taskArn: "arn:task-1",
      clusterArn: "arn:cluster-1",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      exitCode: 1,
    });
    mockIncrement.mockResolvedValue(defaultIncrementResult);
    mockThreshold.mockReturnValue(true);
    mockSend.mockRejectedValue(new ConditionalCheckFailedException({message: "ConditionalCheckFailedException", "$metadata": {}, Item: {}}));

    // Should NOT throw — another handler won the race
    await handler(makeEvent());

    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("catches DDB item missing condition during update without re-throwing", async () => {
    mockExtract.mockReturnValue({
      testId: "abc123",
      region: "us-east-1",
      taskArn: "arn:task-1",
      clusterArn: "arn:cluster-1",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      exitCode: 1,
    });
    mockIncrement.mockRejectedValue(new ConditionalCheckFailedException({message: "ConditionalCheckFailedException", "$metadata": {}}));

    // Should NOT throw — another handler won the race
    await handler(makeEvent());

    expect(mockIncrement).toHaveBeenCalledOnce();
  });

  it("returns void (no return value)", async () => {
    mockExtract.mockReturnValue(undefined);

    await expect(handler(makeEvent())).resolves.toBeUndefined();
  });
});
