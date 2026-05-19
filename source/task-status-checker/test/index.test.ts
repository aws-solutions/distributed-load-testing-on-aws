// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependency modules before importing handler
vi.mock("../src/running-check.js", () => ({
  checkRunningStatus: vi.fn(),
}));
vi.mock("../src/completion.js", () => ({
  monitorCompletion: vi.fn(),
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
        SCENARIOS_BUCKET: "dlt-bucket",
        MAIN_STACK_REGION: "us-east-1",
        AWS_ACCOUNT_ID: "123456789012",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
    sendOperationalMetric: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  UpdateCommand: vi.fn(),
}));

import { type CompletionMonitoringEvent, OperationalMetricEvent, sendOperationalMetric } from "@amzn/dlt-common";
import { monitorCompletion } from "../src/completion.js";
import { handler } from "../src/index.js";
import { checkRunningStatus } from "../src/running-check.js";

const mockSendOperationalMetric = vi.mocked(sendOperationalMetric);

const mockCheckRunning = vi.mocked(checkRunningStatus);
const mockMonitorCompletion = vi.mocked(monitorCompletion);

function makeTestTaskConfig() {
  return {
    region: "us-east-1",
    taskCluster: "dlt-cluster",
    taskCount: 5,
    subnetA: "subnet-aaa",
    subnetB: "subnet-bbb",
    taskSecurityGroup: "sg-123",
    ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
    taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role",
    executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role",
  };
}

function makeRunningCheckEvent() {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testTaskConfig: makeTestTaskConfig(),
  };
}

function makeCompletionEvent(overrides?: Partial<CompletionMonitoringEvent>): CompletionMonitoringEvent {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testType: "jmeter" as const,
    fileType: "jmx",
    showLive: true,
    testDuration: 300,
    prefix: "prefix-1",
    testTaskConfig: makeTestTaskConfig(),
    serviceName: "dlt-test-abc123-us-east-1",
    serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
    taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1",
    taskDefinitionFamily: "dlt-worker-test-abc123",
    desiredCount: 5,
    completedTaskCount: 0,
    isComplete: false,
    timedOut: false,
    pollStartTime: Date.now(),
    ...overrides,
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("running check mode", () => {
    it("should return isRunning true when test is running", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });

      const event = makeRunningCheckEvent();
      const result = await handler(event);

      expect(result).toEqual({ ...event, isRunning: true });
      expect(mockCheckRunning).toHaveBeenCalledOnce();
      expect(mockMonitorCompletion).not.toHaveBeenCalled();
    });

    it("should return isRunning false when test is not running", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: false });

      const event = makeRunningCheckEvent();
      const result = await handler(event);

      expect(result).toEqual({ ...event, isRunning: false });
    });
  });

  describe("completion monitoring mode", () => {
    it("should return updated completion state when tasks are still running", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockResolvedValue({ completedTaskCount: 3, isComplete: false });

      const event = makeCompletionEvent({ completedTaskCount: 2 });
      const result = await handler(event);

      expect(result).toMatchObject({
        completedTaskCount: 3,
        isComplete: false,
        timedOut: false,
      });
      expect(mockCheckRunning).toHaveBeenCalledOnce();
      expect(mockMonitorCompletion).toHaveBeenCalledOnce();
    });

    it("should return isComplete true when all markers found", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockResolvedValue({ completedTaskCount: 5, isComplete: true });

      const event = makeCompletionEvent({ completedTaskCount: 4 });
      const result = await handler(event);

      expect(result).toMatchObject({
        completedTaskCount: 5,
        isComplete: true,
        timedOut: false,
      });
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.RegionComplete }),
      );
    });

    it("should set pollStartTime on first invocation when not present", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockResolvedValue({ completedTaskCount: 0, isComplete: false });

      const { pollStartTime: _, ...eventWithoutPollStart } = makeCompletionEvent();
      const result = await handler(eventWithoutPollStart as CompletionMonitoringEvent);

      expect(result).toHaveProperty("pollStartTime");
      expect((result as CompletionMonitoringEvent).pollStartTime).toBeGreaterThan(0);
    });

    it("should preserve existing pollStartTime across iterations", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockResolvedValue({ completedTaskCount: 1, isComplete: false });

      const fixedStart = Date.now() - 60_000;
      const event = makeCompletionEvent({ pollStartTime: fixedStart });
      const result = await handler(event);

      expect((result as CompletionMonitoringEvent).pollStartTime).toBe(fixedStart);
    });

    it("should set timedOut true when deadline exceeded", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockResolvedValue({ completedTaskCount: 3, isComplete: false });

      // testDuration=300, grace=300 → deadline=600s. Set pollStartTime 601s ago.
      const event = makeCompletionEvent({
        completedTaskCount: 3,
        pollStartTime: Date.now() - 601_000,
      });
      const result = await handler(event);

      expect(result).toMatchObject({
        timedOut: true,
        errorReason: "Test execution timed out",
      });
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.CompletionTimeout }),
      );
    });

    it("should not emit CompletionTimeout or set errorReason when complete but past deadline", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockResolvedValue({ completedTaskCount: 5, isComplete: true });

      // testDuration=300, grace=300 → deadline=600s. Set pollStartTime 601s ago.
      const event = makeCompletionEvent({
        completedTaskCount: 3,
        pollStartTime: Date.now() - 601_000,
      });
      const result = await handler(event);

      expect(result).toMatchObject({
        isComplete: true,
        timedOut: true,
      });
      expect(result).not.toHaveProperty("errorReason");
      expect(mockSendOperationalMetric).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.CompletionTimeout }),
      );
      // Should still emit RegionComplete since the test did finish
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.RegionComplete }),
      );
    });

    it("should not time out when within deadline", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockResolvedValue({ completedTaskCount: 0, isComplete: false });

      const event = makeCompletionEvent({
        pollStartTime: Date.now() - 10_000,
      });
      const result = await handler(event);

      expect(result).toMatchObject({
        timedOut: false,
      });
      expect(result).not.toHaveProperty("errorReason");
    });

    it("should short-circuit with timedOut when test is no longer running", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: false });

      const event = makeCompletionEvent();
      const result = await handler(event);

      expect(result).toMatchObject({
        isComplete: false,
        timedOut: true,
        errorReason: "Task failure threshold breached",
      });
      expect(mockMonitorCompletion).not.toHaveBeenCalled();
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.CompletionThresholdBreached }),
      );
    });
  });

  describe("error handling", () => {
    it("should throw and update DynamoDB when running check fails", async () => {
      mockCheckRunning.mockRejectedValueOnce(new Error("DynamoDB read failed"));

      const { DynamoDBDocumentClient, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
      const mockSend = vi.fn();
      vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

      await expect(handler(makeRunningCheckEvent())).rejects.toThrow("DynamoDB read failed");
      expect(mockSend).toHaveBeenCalledOnce();
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: "dlt-scenarios",
          Key: { testId: "test-abc123" },
        })
      );
    });

    it("should throw and update DynamoDB when completion monitoring fails", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockMonitorCompletion.mockRejectedValueOnce(new Error("S3 access denied"));

      const { DynamoDBDocumentClient, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
      const mockSend = vi.fn();
      vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

      await expect(handler(makeCompletionEvent())).rejects.toThrow("S3 access denied");
      expect(mockSend).toHaveBeenCalledOnce();
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: "dlt-scenarios",
          Key: { testId: "test-abc123" },
        })
      );
    });

    it("should still throw original error when DDB status update also fails", async () => {
      mockCheckRunning.mockRejectedValueOnce(new Error("Original error"));

      const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
      const mockSend = vi.fn().mockRejectedValueOnce(new Error("DDB throttled"));
      vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

      await expect(handler(makeRunningCheckEvent())).rejects.toThrow("Original error");
      expect(mockSend).toHaveBeenCalledOnce();
    });
  });
});
