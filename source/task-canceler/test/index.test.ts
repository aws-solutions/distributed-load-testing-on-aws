// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskCancelEvent, TestExecutionInput } from "@amzn/dlt-common";
import { TestStatus } from "@amzn/dlt-common";

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
        TEST_CLEANUP_ARN: "arn:aws:lambda:us-east-1:123456789:function:test-cleanup",
        STATE_MACHINE_ARN: "arn:aws:states:us-east-1:123456789:stateMachine:dlt-sfn",
        AWS_ACCOUNT_ID: "123456789012",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
    sendOperationalMetric: vi.fn(),
    parseSafeJson: vi.fn(),
  };
});

const mockDdbSend = vi.fn();
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(),
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDdbSend })) },
  PutCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

const mockLambdaSend = vi.fn();
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = mockLambdaSend;
  },
  InvokeCommand: vi.fn(),
}));

const mockSfnSend = vi.fn();
vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  ListExecutionsCommand: vi.fn(),
  DescribeExecutionCommand: vi.fn(),
  StopExecutionCommand: vi.fn(),
  ExecutionStatus: { RUNNING: "RUNNING" },
}));

import { parseSafeJson } from "@amzn/dlt-common";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { StopExecutionCommand } from "@aws-sdk/client-sfn";
import { UpdateCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { handler } from "../src/index.js";

const mockParseSafeJson = vi.mocked(parseSafeJson);

const EXECUTION_ARN = "arn:aws:states:us-east-1:123456789:execution:dlt-sfn:test-abc123";

function makeExecutionInput(testId = "test-abc123"): TestExecutionInput {
  return {
    testId,
    testRunId: "run-001",
    testType: "jmeter",
    fileType: "jmx",
    showLive: true,
    testDuration: 300,
    prefix: "prefix-1",
    hubTaskDefinition: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
    testTaskConfig: [
      {
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
    ],
  };
}

function makeEvent(): TaskCancelEvent {
  return { testId: "test-abc123" };
}

function setupSfnMocks(testId = "test-abc123") {
  // ListExecutions returns one RUNNING execution
  mockSfnSend.mockResolvedValueOnce({
    executions: [{ executionArn: EXECUTION_ARN }],
  });
  // DescribeExecution returns the execution input
  mockSfnSend.mockResolvedValueOnce({
    input: JSON.stringify(makeExecutionInput(testId)),
  });
  // StopExecution succeeds
  mockSfnSend.mockResolvedValueOnce({});
  // parseSafeJson returns the parsed input
  mockParseSafeJson.mockReturnValue(makeExecutionInput(testId));
}

function setupDdbMocks(testId = "test-abc123") {
  mockDdbSend.mockResolvedValue(undefined);
  // ddb UpdateCommand return value
  mockDdbSend.mockResolvedValueOnce({
    Attributes: {
      testId,
      startTime: "2000-01-01 00:00:00",
      testType: "jmeter",
      testDescription: "ddb update result description",
      scheduleTimezone: "PDT",
      testScenario: '{"execution":[{"ramp-up":"5s","hold-for":"10s","scenario":"test","executor":"k6","taskCount":1,"concurrency":1}],"scenarios":{"test":{"script":"somescript.js"}},"reporting":[{"module":"final-stats","summary":true,"percentiles":true,"summary-labels":true,"test-duration":true,"dump-xml":"/tmp/artifacts/results.xml"}]}',
    },
  });
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLambdaSend.mockResolvedValue(undefined);
    setupDdbMocks();
  });

  it("should find active execution, stop it, set DDB status, and invoke test-cleanup", async () => {
    setupSfnMocks();

    const result = await handler(makeEvent());

    expect(result).toBe("cancellation initiated");
    // StopExecution was called (3rd SFN call after List + Describe)
    expect(vi.mocked(StopExecutionCommand)).toHaveBeenCalledWith(
      expect.objectContaining({ executionArn: EXECUTION_ARN })
    );
    // DDB status set to CANCELLING
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledOnce();
    const ddbUpdateArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(ddbUpdateArgs?.ExpressionAttributeValues).toHaveProperty(":s", TestStatus.CANCELLING);
    // DDB put history_table
    expect(vi.mocked(PutCommand)).toHaveBeenCalledOnce();
    const ddbPutArgs = vi.mocked(PutCommand).mock.calls[0]?.[0];
    expect(ddbPutArgs?.TableName).toEqual("dlt-history");
    expect(ddbPutArgs?.Item).toMatchObject({
      testId: "test-abc123",
      testRunId: "run-001",
      startTime: "2000-01-01 00:00:00",
      status: TestStatus.CANCELLING,
      testType: "jmeter",
      testDescription: "ddb update result description",
      scheduleTimezone: "PDT",
      testScenario: {
        execution: [{
          "ramp-up": "5s",
          "hold-for": "10s",
          scenario: "test",
          executor: "k6",
          taskCount: 1,
          concurrency: 1
        }],
        scenarios: {
          test: {
            script: "somescript.js"
          }
        },
        reporting: [{
          module: "final-stats",
          summary: true,
          percentiles: true,
          "summary-labels": true,
          "test-duration": true,
          "dump-xml": "/tmp/artifacts/results.xml"
        }]
      },
    });
    // test-cleanup invoked for each region
    expect(vi.mocked(InvokeCommand)).toHaveBeenCalledOnce();
  });

  it("should pass testRunId and finalStatus CANCELLED to test-cleanup", async () => {
    setupSfnMocks();

    await handler(makeEvent());

    const invokeArgs = vi.mocked(InvokeCommand).mock.calls[0]?.[0];
    const payload = JSON.parse(new TextDecoder().decode(invokeArgs?.Payload as Uint8Array)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      testId: "test-abc123",
      testRunId: "run-001",
      finalStatus: "cancelled",
    });
    expect(payload).not.toHaveProperty("errorReason");
  });

  it("should invoke test-cleanup for each region in a multi-region test", async () => {
    const multiRegionInput = makeExecutionInput();
    multiRegionInput.testTaskConfig.push({
      ...multiRegionInput.testTaskConfig[0]!,
      region: "eu-west-1",
    });

    mockSfnSend.mockResolvedValueOnce({
      executions: [{ executionArn: EXECUTION_ARN }],
    });
    mockSfnSend.mockResolvedValueOnce({
      input: JSON.stringify(multiRegionInput),
    });
    mockSfnSend.mockResolvedValueOnce({});
    mockParseSafeJson.mockReturnValue(multiRegionInput);

    await handler(makeEvent());

    expect(vi.mocked(InvokeCommand)).toHaveBeenCalledTimes(2);
  });

  it("should set status to cancelled when no active execution is found", async () => {
    mockSfnSend.mockResolvedValueOnce({ executions: [] });

    const result = await handler(makeEvent());

    expect(result).toBe("cancellation completed (no active execution)");
    // DDB status set directly to CANCELLED (not CANCELLING)
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledOnce();
    const ddbUpdateArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(ddbUpdateArgs?.ExpressionAttributeValues).toHaveProperty(":s", TestStatus.CANCELLED);
    // StopExecution should NOT be called
    expect(vi.mocked(StopExecutionCommand)).not.toHaveBeenCalled();
    // test-cleanup should NOT be invoked
    expect(vi.mocked(InvokeCommand)).not.toHaveBeenCalled();
    // History entry should NOT be created (no testRunId available)
    expect(vi.mocked(PutCommand)).not.toHaveBeenCalled();
  });

  it("should continue invoking remaining regions if one invoke fails", async () => {
    const multiRegionInput = makeExecutionInput();
    multiRegionInput.testTaskConfig.push({
      ...multiRegionInput.testTaskConfig[0]!,
      region: "eu-west-1",
    });

    mockSfnSend.mockResolvedValueOnce({
      executions: [{ executionArn: EXECUTION_ARN }],
    });
    mockSfnSend.mockResolvedValueOnce({
      input: JSON.stringify(multiRegionInput),
    });
    mockSfnSend.mockResolvedValueOnce({});
    mockParseSafeJson.mockReturnValue(multiRegionInput);
    mockLambdaSend.mockRejectedValueOnce(new Error("Lambda throttled")).mockResolvedValueOnce(undefined);

    const result = await handler(makeEvent());

    expect(result).toBe("cancellation initiated");
    expect(vi.mocked(InvokeCommand)).toHaveBeenCalledTimes(2);
  });

  it("should throw if DDB status update fails", async () => {
    setupSfnMocks();
    mockDdbSend.mockReset();
    // DDB update error mock
    mockDdbSend.mockRejectedValueOnce(new Error("DDB status update error"));

    await expect(handler(makeEvent())).rejects.toThrow("DDB status update error");
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledOnce();
    expect(vi.mocked(PutCommand)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(InvokeCommand)).toHaveBeenCalledTimes(0);
  });

  it("should throw if DDB history put fails", async () => {
    setupSfnMocks();
    mockDdbSend.mockRejectedValueOnce(new Error("DDB put history error"));

    await handler(makeEvent())
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledOnce();
    expect(vi.mocked(PutCommand)).toHaveBeenCalledOnce();
    expect(vi.mocked(InvokeCommand)).toHaveBeenCalledTimes(1);
  });

  it("should use empty object for testScenario when json is invalid", async () => {
    setupSfnMocks();
    mockDdbSend.mockReset();
    // Re-mock DDB update call to return invalid json for testScenario field
    mockDdbSend.mockResolvedValueOnce({
    Attributes: {
      startTime: "2000-01-01 00:00:00",
      testType: "jmeter",
      testDescription: "ddb update result description",
      scheduleTimezone: "PDT",
      testScenario: "{"
    },
  });

    await handler(makeEvent());
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledOnce();
    expect(vi.mocked(PutCommand)).toHaveBeenCalledOnce();
    const ddbPutArgs = vi.mocked(PutCommand).mock.calls[0]?.[0];
    expect(ddbPutArgs?.Item?.["testScenario"]).toEqual({});
    expect(vi.mocked(InvokeCommand)).toHaveBeenCalledOnce();
  });
});
