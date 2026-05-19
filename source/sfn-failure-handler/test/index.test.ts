// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TestCleanupEvent, TestExecutionInput, TestTaskRegionConfig } from "@amzn/dlt-common";
import { TestStatus } from "@amzn/dlt-common";

const { mockSfnSend, mockLambdaSend } = vi.hoisted(() => ({
  mockSfnSend: vi.fn(),
  mockLambdaSend: vi.fn(),
}));

vi.mock("../src/execution-parser.js", () => ({
  parseExecutionInput: vi.fn(),
  buildCleanupEvents: vi.fn(),
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
        TEST_CLEANUP_ARN: "arn:aws:lambda:us-east-1:123456789:function:test-cleanup",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
  };
});
vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  DescribeExecutionCommand: vi.fn(),
}));
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = mockLambdaSend;
  },
  InvokeCommand: vi.fn(),
  InvocationType: { Event: "Event" },
}));

import { buildCleanupEvents, parseExecutionInput } from "../src/execution-parser.js";
import { handler } from "../src/index.js";

const mockParseExecutionInput = vi.mocked(parseExecutionInput);
const mockBuildCleanupEvents = vi.mocked(buildCleanupEvents);

function makeEvent() {
  return {
    source: "aws.states" as const,
    "detail-type": "Step Functions Execution Status Change" as const,
    detail: {
      executionArn: "arn:aws:states:us-east-1:123456789:execution:dlt-sfn:test-abc123",
      stateMachineArn: "arn:aws:states:us-east-1:123456789:stateMachine:dlt-sfn",
      status: "FAILED" as const,
    },
  };
}

function makeRegionConfig(): TestTaskRegionConfig {
  return {
    region: "us-east-1",
    taskCluster: "dlt-cluster",
    taskCount: 10,
    subnetA: "subnet-aaa",
    subnetB: "subnet-bbb",
    taskSecurityGroup: "sg-123",
    ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
    taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role",
    executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role",
  };
}

function makeCleanupEvent(region: string): TestCleanupEvent {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testTaskConfig: { ...makeRegionConfig(), region },
    finalStatus: TestStatus.FAILED,
    errorReason: "Step function execution failed",
  };
}

function makeExecutionInput(): TestExecutionInput {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testTaskConfig: [makeRegionConfig()],
    testType: "jmeter",
    fileType: "jmx",
    showLive: true,
    testDuration: 300,
    prefix: "prefix-1",
    hubTaskDefinition: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSfnSend.mockResolvedValue({ input: '{"testId":"test-abc123"}' });
    mockLambdaSend.mockResolvedValue({});

    mockParseExecutionInput.mockReturnValue(makeExecutionInput());
    mockBuildCleanupEvents.mockReturnValue([makeCleanupEvent("us-east-1")]);
  });

  it("should describe execution, parse input, build events, and invoke test-cleanup", async () => {
    await handler(makeEvent());

    expect(mockSfnSend).toHaveBeenCalledOnce();
    expect(mockParseExecutionInput).toHaveBeenCalledOnce();
    expect(mockBuildCleanupEvents).toHaveBeenCalledOnce();
    expect(mockLambdaSend).toHaveBeenCalledOnce();
  });

  it("should invoke test-cleanup for each region in a multi-region test", async () => {
    mockBuildCleanupEvents.mockReturnValue([makeCleanupEvent("us-east-1"), makeCleanupEvent("eu-west-1")]);

    await handler(makeEvent());

    expect(mockLambdaSend).toHaveBeenCalledTimes(2);
  });

  it("should not invoke test-cleanup when DescribeExecution returns no input", async () => {
    mockSfnSend.mockResolvedValue({ input: undefined });

    await handler(makeEvent());

    expect(mockParseExecutionInput).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("should not throw when DescribeExecution fails", async () => {
    mockSfnSend.mockRejectedValue(new Error("SFN access denied"));

    await handler(makeEvent());

    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("should not throw when parseExecutionInput throws", async () => {
    mockParseExecutionInput.mockImplementation(() => {
      throw new Error("Invalid execution input");
    });

    await handler(makeEvent());

    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("should continue invoking remaining regions when one invocation fails", async () => {
    mockBuildCleanupEvents.mockReturnValue([makeCleanupEvent("us-east-1"), makeCleanupEvent("eu-west-1")]);
    mockLambdaSend.mockRejectedValueOnce(new Error("Lambda throttled")).mockResolvedValueOnce({});

    await handler(makeEvent());

    expect(mockLambdaSend).toHaveBeenCalledTimes(2);
  });

  it("should return void", async () => {
    await handler(makeEvent());

    // handler returns Promise<void> — no assertion needed beyond not throwing
  });
});
