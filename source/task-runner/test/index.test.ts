// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock all dependency modules before importing handler
vi.mock("../src/task-definition.js", () => ({
  createTestTaskDefinition: vi.fn(),
}));
vi.mock("../src/service.js", () => ({
  createEcsService: vi.fn(),
}));
vi.mock("../src/dashboard.js", () => ({
  createDashboard: vi.fn(),
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
}));
vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn(),
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  UpdateCommand: vi.fn(),
}));

import { createDashboard } from "../src/dashboard.js";
import { handler } from "../src/index.js";
import { createEcsService } from "../src/service.js";
import { createTestTaskDefinition } from "../src/task-definition.js";

const mockCreateTaskDef = vi.mocked(createTestTaskDefinition);
const mockCreateService = vi.mocked(createEcsService);
const mockCreateDashboard = vi.mocked(createDashboard);

function makeEvent() {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testType: "jmeter" as const,
    fileType: "jmx",
    showLive: true,
    testDuration: 300,
    prefix: "prefix-1",
    hubTaskDefinition: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
    testTaskConfig: {
      region: "us-east-1",
      taskCluster: "dlt-cluster",
      taskCount: 10,
      subnetA: "subnet-aaa",
      subnetB: "subnet-bbb",
      taskSecurityGroup: "sg-123",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskRoleArn: "arn:aws:iam::123456789:role/task-role",
      executionRoleArn: "arn:aws:iam::123456789:role/exec-role",
    },
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateTaskDef.mockResolvedValue({
      taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1",
      family: "dlt-worker-test-abc123",
    });

    mockCreateService.mockResolvedValue({
      serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
      serviceName: "dlt-test-abc123-us-east-1",
    });

    mockCreateDashboard.mockResolvedValue(undefined);
  });

  it("should return a TaskRunnerResult assembling pass-through and service fields", async () => {
    const event = makeEvent();
    const result = await handler(event);

    expect(result).toEqual({
      testId: "test-abc123",
      testRunId: "run-001",
      testType: "jmeter",
      fileType: "jmx",
      showLive: true,
      testDuration: 300,
      prefix: "prefix-1",
      testTaskConfig: event.testTaskConfig,
      serviceName: "dlt-test-abc123-us-east-1",
      serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
      taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1",
      taskDefinitionFamily: "dlt-worker-test-abc123",
      desiredCount: 10,
    });
  });

  it("should pass hubTaskDefinition and spoke roles to createTestTaskDefinition", async () => {
    await handler(makeEvent());

    expect(mockCreateTaskDef).toHaveBeenCalledOnce();
    const call = mockCreateTaskDef.mock.calls[0];
    if (!call) throw new Error("Expected createTestTaskDefinition call");
    const params = call[0];
    expect(params.hubTaskDefinition).toBe("arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1");
    expect(params.taskRoleArn).toBe("arn:aws:iam::123456789:role/task-role");
    expect(params.executionRoleArn).toBe("arn:aws:iam::123456789:role/exec-role");
    expect(params.ecsCloudWatchLogGroup).toBe("/ecs/dlt-load-tester");
    expect(params.region).toBe("us-east-1");
    expect(params.envVars["TIMEOUT"]).toBe("900");
    expect(params.envVars["TEST_ID"]).toBe("test-abc123");
  });

  it("should call createEcsService with correct service name format", async () => {
    await handler(makeEvent());

    expect(mockCreateService).toHaveBeenCalledOnce();
    const call = mockCreateService.mock.calls[0];
    if (!call) throw new Error("Expected createEcsService call");
    const params = call[0];
    expect(params.serviceName).toBe("dlt-test-abc123-us-east-1");
    expect(params.desiredCount).toBe(10);
    expect(params.subnets).toEqual(["subnet-aaa", "subnet-bbb"]);
  });

  it("should call createDashboard", async () => {
    await handler(makeEvent());
    expect(mockCreateDashboard).toHaveBeenCalledOnce();
  });

  it("should throw and not swallow errors from service creation", async () => {
    mockCreateService.mockRejectedValueOnce(new Error("Service limit exceeded"));

    await expect(handler(makeEvent())).rejects.toThrow("Service limit exceeded");
  });

  it("should throw and not swallow errors from task definition creation", async () => {
    mockCreateTaskDef.mockRejectedValueOnce(new Error("Task def not found"));

    await expect(handler(makeEvent())).rejects.toThrow("Task def not found");
  });

  it("should update DynamoDB with failure status when dashboard creation fails", async () => {
    const { DynamoDBDocumentClient, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    const mockSend = vi.fn();
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockCreateDashboard.mockRejectedValueOnce(new Error("Dashboard widget limit"));

    await expect(handler(makeEvent())).rejects.toThrow("Dashboard widget limit");
    // mockSend is called twice: once for queued→provisioning transition, once for error status update
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(UpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: "dlt-scenarios",
        Key: { testId: "test-abc123" },
      })
    );
  });

  it("should still throw the original error when DDB status update also fails", async () => {
    const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
    const mockSend = vi.fn().mockRejectedValueOnce(new Error("DDB throttled"));
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockCreateService.mockRejectedValueOnce(new Error("Service limit exceeded"));

    await expect(handler(makeEvent())).rejects.toThrow("Service limit exceeded");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("should update DDB to failed when createService throws after successful taskDef registration", async () => {
    const { DynamoDBDocumentClient, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    const mockSend = vi.fn();
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockCreateService.mockRejectedValueOnce(new Error("Service limit exceeded"));

    await expect(handler(makeEvent())).rejects.toThrow("Service limit exceeded");

    // Task definition was registered before the service creation failure
    expect(mockCreateTaskDef).toHaveBeenCalledOnce();

    // DDB was called once (error path only — provisioning update never reached)
    expect(mockSend).toHaveBeenCalledOnce();
    expect(UpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: "dlt-scenarios",
        Key: { testId: "test-abc123" },
        ExpressionAttributeValues: expect.objectContaining({ ":s": "failed" }) as Record<string, string>,
      })
    );
  });
});
