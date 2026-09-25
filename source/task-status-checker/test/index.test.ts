// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDdbSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn(),
}));

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
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDdbSend })) },
  UpdateCommand: vi.fn(),
}));

import { type CompletionMonitoringEvent, OperationalMetricEvent, sendOperationalMetric } from "@amzn/dlt-common";
import { type CompletionMonitorResult, monitorCompletion } from "../src/completion.js";
import { handler } from "../src/index.js";
import { checkRunningStatus } from "../src/running-check.js";

const mockSendOperationalMetric = vi.mocked(sendOperationalMetric);

const mockCheckRunning = vi.mocked(checkRunningStatus);
const mockMonitorCompletion = vi.mocked(monitorCompletion);

function mockCompletion(
  result: Omit<CompletionMonitorResult, "warningTaskCount"> & Partial<Pick<CompletionMonitorResult, "warningTaskCount">>
): void {
  mockMonitorCompletion.mockResolvedValue({ warningTaskCount: 0, ...result });
}

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
    nativeRunMode: null,
    serviceName: "dlt-test-abc123-us-east-1",
    serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
    taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1",
    taskDefinitionFamily: "dlt-worker-test-abc123",
    desiredCount: 5,
    completedTaskCount: 0,
    isComplete: false,
    maxDurationReached: false,
    timedOut: false,
    pollStartTime: Date.now(),
    pollIntervalSeconds: 10,
    ...overrides,
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDdbSend.mockReset();
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
      mockCompletion({
        completedTaskCount: 3,
        isComplete: false,
      });

      const event = makeCompletionEvent({ completedTaskCount: 2 });
      const result = await handler(event);

      expect(result).toMatchObject({
        completedTaskCount: 3,
        isComplete: false,
        maxDurationReached: false,
        timedOut: false,
      });
      expect(mockCheckRunning).toHaveBeenCalledOnce();
      expect(mockMonitorCompletion).toHaveBeenCalledOnce();
    });

    it("should return isComplete true when all markers found", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 5,
        isComplete: true,
      });

      const nativeRunMode = {
        maxTestDurationSeconds: 120,
      };
      const event = makeCompletionEvent({ completedTaskCount: 4, nativeRunMode });
      const result = await handler(event);

      expect(result).toMatchObject({
        completedTaskCount: 5,
        isComplete: true,
        maxDurationReached: false,
        timedOut: false,
        nativeRunMode,
      });
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Type: OperationalMetricEvent.RegionComplete,
        })
      );
    });

    it("should set pollStartTime on first invocation when not present", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 0,
        isComplete: false,
      });

      const { pollStartTime: _, ...eventWithoutPollStart } = makeCompletionEvent();
      const result = await handler(eventWithoutPollStart as CompletionMonitoringEvent);

      expect(result).toHaveProperty("pollStartTime");
      expect((result as CompletionMonitoringEvent).pollStartTime).toBeGreaterThan(0);
    });

    it("should preserve existing pollStartTime across iterations", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 1,
        isComplete: false,
      });

      const fixedStart = Date.now() - 60_000;
      const event = makeCompletionEvent({ pollStartTime: fixedStart });
      const result = await handler(event);

      expect((result as CompletionMonitoringEvent).pollStartTime).toBe(fixedStart);
    });

    it("should return pollIntervalSeconds on every completion path", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });

      // The Wait state reads this via SecondsPath, so a missing value is a
      // runtime failure. Cover still-running, complete, and timed-out paths.
      const cases = [
        { completedTaskCount: 0, isComplete: false, event: makeCompletionEvent() },
        { completedTaskCount: 5, isComplete: true, event: makeCompletionEvent() },
        {
          completedTaskCount: 3,
          isComplete: false,
          event: makeCompletionEvent({ pollStartTime: Date.now() - 601_000 }),
        },
      ];

      for (const { completedTaskCount, isComplete, event } of cases) {
        mockCompletion({ completedTaskCount, isComplete });
        const result = await handler(event);

        // testDuration=300 → below the floor threshold, so the minimum applies.
        expect((result as CompletionMonitoringEvent).pollIntervalSeconds).toBe(10);
      }
    });

    it("should scale pollIntervalSeconds up for a long test", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({ completedTaskCount: 0, isComplete: false });

      const event = makeCompletionEvent({ testDuration: 24 * 3600 });
      const result = await handler(event);

      expect((result as CompletionMonitoringEvent).pollIntervalSeconds).toBeGreaterThan(10);
    });

    it("should return pollIntervalSeconds when the test is no longer running", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: false });

      const result = await handler(makeCompletionEvent());

      expect(result).toMatchObject({ timedOut: true, pollIntervalSeconds: 10 });
    });

    it("should set timedOut true when deadline exceeded", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 3,
        isComplete: false,
      });

      // testDuration=300, grace=300 → deadline=600s. Set pollStartTime 601s ago.
      const event = makeCompletionEvent({
        completedTaskCount: 3,
        pollStartTime: Date.now() - 601_000,
      });
      const result = await handler(event);

      expect(result).toMatchObject({
        timedOut: true,
        maxDurationReached: false,
        errorReason: "Test execution timed out",
        nativeRunMode: null,
      });
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Type: OperationalMetricEvent.CompletionTimeout,
          TimeoutCause: "execution_deadline",
          WarningTaskCount: 0,
          HealthyThreshold: 90,
          WarningGraceStarted: false,
        })
      );
    });

    it("should not emit CompletionTimeout or set errorReason when complete but past deadline", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 5,
        isComplete: true,
      });

      // testDuration=300, grace=300 → deadline=600s. Set pollStartTime 601s ago.
      const event = makeCompletionEvent({
        completedTaskCount: 3,
        pollStartTime: Date.now() - 601_000,
      });
      const result = await handler(event);

      expect(result).toMatchObject({
        isComplete: true,
        maxDurationReached: false,
        timedOut: true,
      });
      expect(result).not.toHaveProperty("errorReason");
      expect(mockSendOperationalMetric).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.CompletionTimeout })
      );
      // Should still emit RegionComplete since the test did finish
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.RegionComplete })
      );
    });

    it("should not time out when within deadline", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 0,
        isComplete: false,
      });

      const event = makeCompletionEvent({
        pollStartTime: Date.now() - 10_000,
      });
      const result = await handler(event);

      expect(result).toMatchObject({
        maxDurationReached: false,
        timedOut: false,
      });
      expect(result).not.toHaveProperty("errorReason");
    });

    it("should mark native max duration reached while allowing finalization grace", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 3,
        isComplete: false,
      });

      const result = await handler(
        makeCompletionEvent({
          nativeRunMode: { maxTestDurationSeconds: 60 },
          pollStartTime: Date.now() - 61_000,
        })
      );

      expect(result).toMatchObject({
        completedTaskCount: 3,
        isComplete: false,
        maxDurationReached: true,
        timedOut: false,
      });
      expect(result).not.toHaveProperty("errorReason");
    });

    it("should keep native max duration reached when all tasks finalize during grace", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 5,
        isComplete: true,
      });

      const result = await handler(
        makeCompletionEvent({
          nativeRunMode: { maxTestDurationSeconds: 60 },
          pollStartTime: Date.now() - 61_000,
        })
      );

      expect(result).toMatchObject({
        completedTaskCount: 5,
        isComplete: true,
        maxDurationReached: true,
        timedOut: false,
      });
    });

    it("should continue collecting native completion markers after max when the test is no longer running", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: false });
      mockCompletion({
        completedTaskCount: 3,
        isComplete: false,
      });

      const result = await handler(
        makeCompletionEvent({
          nativeRunMode: { maxTestDurationSeconds: 60 },
          pollStartTime: Date.now() - 61_000,
        })
      );

      expect(result).toMatchObject({
        completedTaskCount: 3,
        isComplete: false,
        maxDurationReached: true,
        timedOut: false,
      });
      expect(result).not.toHaveProperty("errorReason");
      expect(mockMonitorCompletion).toHaveBeenCalledOnce();
      expect(mockSendOperationalMetric).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.CompletionThresholdBreached })
      );
    });

    it("should use native max duration plus grace for the deadline", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true });
      mockCompletion({
        completedTaskCount: 0,
        isComplete: false,
      });

      const event = makeCompletionEvent({
        testDuration: 3600,
        nativeRunMode: { maxTestDurationSeconds: 60 },
        pollStartTime: Date.now() - 361_000,
      });
      const result = await handler(event);

      expect(result).toMatchObject({
        nativeRunMode: { maxTestDurationSeconds: 60 },
        maxDurationReached: true,
        timedOut: true,
        errorReason: "Test execution timed out",
      });
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Type: OperationalMetricEvent.CompletionTimeout,
          Deadline: 360,
        })
      );
    });

    it("does not start a warning deadline for one warning out of ten at 90%", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockCompletion({ completedTaskCount: 1, isComplete: false, warningTaskCount: 1 });

      const result = await handler(
        makeCompletionEvent({
          desiredCount: 10,
          nativeRunMode: { maxTestDurationSeconds: 300 },
        })
      );

      expect(result).not.toHaveProperty("warningDeadline");
      expect(result).toMatchObject({ timedOut: false, pollIntervalSeconds: 10 });
    });

    it("starts one non-extendable regional deadline for two warnings out of ten at 90%", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockCompletion({ completedTaskCount: 2, isComplete: false, warningTaskCount: 2 });
      const before = Date.now();

      const first = (await handler(
        makeCompletionEvent({
          desiredCount: 10,
          nativeRunMode: { maxTestDurationSeconds: 300 },
        })
      )) as CompletionMonitoringEvent;

      expect(first.warningDeadline).toBeGreaterThanOrEqual(before + 120_000);

      mockCompletion({ completedTaskCount: 3, isComplete: false, warningTaskCount: 3 });
      const second = (await handler(first)) as CompletionMonitoringEvent;
      expect(second.warningDeadline).toBe(first.warningDeadline);
    });

    it("keeps the normal poll interval while a warning deadline is active", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockCompletion({ completedTaskCount: 2, isComplete: false, warningTaskCount: 2 });

      const result = await handler(
        makeCompletionEvent({
          desiredCount: 10,
          testDuration: 24 * 3600,
          nativeRunMode: { maxTestDurationSeconds: 24 * 3600 },
          warningDeadline: Date.now() + 5_000,
        })
      );

      expect(result).toMatchObject({ timedOut: false, pollIntervalSeconds: 40 });
    });

    it("uses the current marker listing as the final check when the warning deadline expires", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockCompletion({ completedTaskCount: 2, isComplete: false, warningTaskCount: 2 });
      const pollStartTime = Date.now() - 421_000;
      const warningDeadline = pollStartTime + 420_000;

      const result = await handler(
        makeCompletionEvent({
          desiredCount: 10,
          nativeRunMode: { maxTestDurationSeconds: 300 },
          pollStartTime,
          warningDeadline,
        })
      );

      expect(mockMonitorCompletion).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        isComplete: false,
        timedOut: true,
        errorReason: "Framework warning threshold breached",
      });
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Type: OperationalMetricEvent.CompletionTimeout,
          Deadline: 420,
          TimeoutCause: "framework_warning_grace",
          WarningTaskCount: 2,
          HealthyThreshold: 90,
          WarningGraceStarted: true,
        })
      );
    });

    it("defers timeout to the next poll when the warning deadline expires during marker listing", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockMonitorCompletion.mockImplementationOnce(() => {
        expect(Date.now()).toBe(1_001);
        return Promise.resolve({ completedTaskCount: 9, isComplete: false, warningTaskCount: 2 });
      });
      const event = makeCompletionEvent({
        desiredCount: 10,
        nativeRunMode: { maxTestDurationSeconds: 300 },
        pollStartTime: 0,
        warningDeadline: 1_000,
      });
      const nowSpy = vi.spyOn(Date, "now").mockReturnValueOnce(900).mockReturnValueOnce(999).mockReturnValue(1_001);

      const result = await handler(event);

      expect(mockMonitorCompletion).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        completedTaskCount: 9,
        isComplete: false,
        timedOut: false,
        pollIntervalSeconds: 10,
      });
      nowSpy.mockRestore();
    });

    it("lets a complete regional snapshot win at the warning deadline", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockCompletion({ completedTaskCount: 10, isComplete: true, warningTaskCount: 10 });

      const result = await handler(
        makeCompletionEvent({
          desiredCount: 10,
          nativeRunMode: { maxTestDurationSeconds: 300 },
          warningDeadline: Date.now() - 1,
        })
      );

      expect(result).toMatchObject({ isComplete: true, timedOut: false });
      expect(result).not.toHaveProperty("errorReason");
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.RegionComplete })
      );
    });

    it("uses execution deadline precedence when both timeout conditions are true", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockCompletion({ completedTaskCount: 2, isComplete: false, warningTaskCount: 2 });

      const result = await handler(
        makeCompletionEvent({
          desiredCount: 10,
          nativeRunMode: { maxTestDurationSeconds: 300 },
          pollStartTime: Date.now() - 601_000,
          warningDeadline: Date.now() - 1,
        })
      );

      expect(result).toMatchObject({
        isComplete: false,
        timedOut: true,
        errorReason: "Test execution timed out",
      });
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Type: OperationalMetricEvent.CompletionTimeout,
          Deadline: 600,
          TimeoutCause: "execution_deadline",
          WarningTaskCount: 2,
          HealthyThreshold: 90,
          WarningGraceStarted: true,
        })
      );
    });

    it("ignores warning coordination for legacy tests", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: true, healthyThreshold: 90 });
      mockCompletion({ completedTaskCount: 2, isComplete: false, warningTaskCount: 2 });

      const result = await handler(makeCompletionEvent({ desiredCount: 10, nativeRunMode: null }));

      expect(result).not.toHaveProperty("warningDeadline");
      expect(result).toMatchObject({ timedOut: false, pollIntervalSeconds: 10 });
    });

    it("should short-circuit with timedOut when test is no longer running", async () => {
      mockCheckRunning.mockResolvedValue({ isRunning: false });

      const event = makeCompletionEvent();
      const result = await handler(event);

      expect(result).toMatchObject({
        isComplete: false,
        timedOut: true,
        errorReason: "Task failure threshold breached",
        nativeRunMode: null,
        maxDurationReached: false,
      });
      expect(mockMonitorCompletion).not.toHaveBeenCalled();
      expect(mockSendOperationalMetric).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Type: OperationalMetricEvent.CompletionThresholdBreached })
      );
    });
  });

  describe("error handling", () => {
    it("should throw and update DynamoDB when running check fails", async () => {
      mockCheckRunning.mockRejectedValueOnce(new Error("DynamoDB read failed"));

      const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");

      await expect(handler(makeRunningCheckEvent())).rejects.toThrow("DynamoDB read failed");
      expect(mockDdbSend).toHaveBeenCalledOnce();
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

      const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");

      await expect(handler(makeCompletionEvent())).rejects.toThrow("S3 access denied");
      expect(mockDdbSend).toHaveBeenCalledOnce();
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: "dlt-scenarios",
          Key: { testId: "test-abc123" },
        })
      );
    });

    it("should still throw original error when DDB status update also fails", async () => {
      mockCheckRunning.mockRejectedValueOnce(new Error("Original error"));

      mockDdbSend.mockRejectedValueOnce(new Error("DDB throttled"));

      await expect(handler(makeRunningCheckEvent())).rejects.toThrow("Original error");
      expect(mockDdbSend).toHaveBeenCalledOnce();
    });
  });
});
