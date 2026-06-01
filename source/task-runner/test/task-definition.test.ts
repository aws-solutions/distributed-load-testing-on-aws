// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { RegisterTaskDefinitionCommandInput } from "@aws-sdk/client-ecs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTestTaskDefinitionParams } from "../src/task-definition.js";
import { createTestTaskDefinition } from "../src/task-definition.js";

const mockHubSend = vi.fn<(command: { input: unknown }) => Promise<unknown>>();
const mockSpokeSend = vi.fn<(command: { input: unknown }) => Promise<unknown>>();

const mockHubEcs = { send: mockHubSend } as unknown as import("@aws-sdk/client-ecs").ECSClient;
const mockSpokeEcs = { send: mockSpokeSend } as unknown as import("@aws-sdk/client-ecs").ECSClient;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
};

function baseParams(overrides?: Partial<CreateTestTaskDefinitionParams>): CreateTestTaskDefinitionParams {
  return {
    hubEcs: mockHubEcs,
    spokeEcs: mockSpokeEcs,
    hubTaskDefinition: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
    taskRoleArn: "arn:aws:iam::123456789:role/spoke-task-role",
    executionRoleArn: "arn:aws:iam::123456789:role/spoke-exec-role",
    ecsCloudWatchLogGroup: "/ecs/spoke-log-group",
    region: "us-west-2",
    testId: "test-abc123",
    testRunId: "run-001",
    envVars: { TEST_ID: "test-abc123", TEST_TYPE: "jmeter" },
    solutionId: "SO0062",
    logger: mockLogger as never,
    ...overrides,
  };
}

const HUB_CONTAINER = {
  name: "load-tester",
  image: "123456789.dkr.ecr.us-east-1.amazonaws.com/dlt:latest",
  cpu: 0,
  memory: 512,
  essential: true,
  portMappings: [{ containerPort: 50000 }],
  logConfiguration: { logDriver: "awslogs", options: {} },
  healthCheck: { command: ["CMD-SHELL", "test -f /tmp/health_ready || exit 1"] },
  environment: [],
  mountPoints: [],
  volumesFrom: [],
  ulimits: [],
};

const HUB_TASK_DEF = {
  taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
  taskRoleArn: "arn:aws:iam::123456789:role/hub-task-role",
  executionRoleArn: "arn:aws:iam::123456789:role/hub-exec-role",
  networkMode: "awsvpc",
  containerDefinitions: [HUB_CONTAINER],
  volumes: [],
  requiresCompatibilities: ["FARGATE"],
  cpu: "512",
  memory: "1024",
  runtimePlatform: { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" },
};

function hubCallInput(callIndex: number): unknown {
  const call = mockHubSend.mock.calls[callIndex];
  if (!call) throw new Error(`Expected mockHubSend call at index ${callIndex}`);
  return call[0].input;
}

function spokeCallInput(callIndex: number): unknown {
  const call = mockSpokeSend.mock.calls[callIndex];
  if (!call) throw new Error(`Expected mockSpokeSend call at index ${callIndex}`);
  return call[0].input;
}

describe("createTestTaskDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should describe hub task def and register in spoke with spoke roles and log config and base tags", async () => {
    const baseTags = [{ key: "CostCenter", value: "12345" }];
    mockHubSend.mockResolvedValueOnce({ taskDefinition: HUB_TASK_DEF, tags: baseTags });
    mockSpokeSend.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: "arn:aws:ecs:us-west-2:123456789:task-definition/dlt-worker-test-abc123:1",
        revision: 1,
      },
    });

    const result = await createTestTaskDefinition(baseParams());

    expect(result.taskDefinitionArn).toBe("arn:aws:ecs:us-west-2:123456789:task-definition/dlt-worker-test-abc123:1");
    expect(result.family).toBe("dlt-worker-test-abc123");

    // Hub ECS: DescribeTaskDefinition with tags
    expect(hubCallInput(0)).toEqual({ taskDefinition: HUB_TASK_DEF.taskDefinitionArn, include: ["TAGS"] });

    // Spoke ECS: RegisterTaskDefinition with spoke roles and log config
    const registerInput = spokeCallInput(0) as RegisterTaskDefinitionCommandInput;
    expect(registerInput.family).toBe("dlt-worker-test-abc123");
    expect(registerInput.taskRoleArn).toBe("arn:aws:iam::123456789:role/spoke-task-role");
    expect(registerInput.executionRoleArn).toBe("arn:aws:iam::123456789:role/spoke-exec-role");
    expect(registerInput.containerDefinitions?.[0]?.logConfiguration).toEqual({
      logDriver: "awslogs",
      options: {
        "awslogs-group": "/ecs/spoke-log-group",
        "awslogs-region": "us-west-2",
        "awslogs-stream-prefix": "load-testing",
      },
    });
    // Container shape from hub
    expect(registerInput.containerDefinitions?.[0]?.image).toBe(HUB_CONTAINER.image);
    expect(registerInput.cpu).toBe(HUB_TASK_DEF.cpu);
    expect(registerInput.memory).toBe(HUB_TASK_DEF.memory);
    expect(registerInput.runtimePlatform).toEqual(HUB_TASK_DEF.runtimePlatform);
    // Env vars injected
    expect(registerInput.containerDefinitions?.[0]?.environment).toEqual([
      { name: "TEST_ID", value: "test-abc123" },
      { name: "TEST_TYPE", value: "jmeter" },
    ]);
    // Base tags should be preserved, with solution tags appended
    expect(registerInput.tags).toEqual([
      { key: "CostCenter", value: "12345" },
      { key: "SolutionId", value: "SO0062" },
      { key: "TestId", value: "test-abc123" },
      { key: "TestRunId", value: "run-001" },
    ]);
  });

  it("should throw if hub task definition is not found", async () => {
    mockHubSend.mockResolvedValueOnce({ taskDefinition: undefined });

    await expect(createTestTaskDefinition(baseParams())).rejects.toThrow("Hub task definition not found");
  });

  it("should throw if hub task definition has no containers", async () => {
    mockHubSend.mockResolvedValueOnce({
      taskDefinition: { ...HUB_TASK_DEF, containerDefinitions: [] },
    });

    await expect(createTestTaskDefinition(baseParams())).rejects.toThrow("no container definitions");
  });

  it("should throw if hub task definition has multiple containers", async () => {
    mockHubSend.mockResolvedValueOnce({
      taskDefinition: {
        ...HUB_TASK_DEF,
        containerDefinitions: [HUB_CONTAINER, { ...HUB_CONTAINER, name: "sidecar" }],
      },
    });

    await expect(createTestTaskDefinition(baseParams())).rejects.toThrow("unexpected number of container definitions");
  });

  it("should throw if register returns no ARN", async () => {
    mockHubSend.mockResolvedValueOnce({ taskDefinition: HUB_TASK_DEF });
    mockSpokeSend.mockResolvedValueOnce({ taskDefinition: { taskDefinitionArn: undefined } });

    await expect(createTestTaskDefinition(baseParams())).rejects.toThrow("no ARN returned");
  });

  it("should merge hub env vars with test-specific env vars (test wins on conflict)", async () => {
    const hubContainerWithEnv = {
      ...HUB_CONTAINER,
      environment: [
        { name: "JVM_ARGS", value: "-Xmx512m" },
        { name: "CUSTOM_VAR", value: "customer-value" },
        { name: "TEST_TYPE", value: "hub-default" },
      ],
    };
    mockHubSend.mockResolvedValueOnce({
      taskDefinition: { ...HUB_TASK_DEF, containerDefinitions: [hubContainerWithEnv] },
    });
    mockSpokeSend.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: "arn:aws:ecs:us-west-2:123456789:task-definition/dlt-worker-test-abc123:1",
        revision: 1,
      },
    });

    await createTestTaskDefinition(baseParams());

    const registerInput = spokeCallInput(0) as RegisterTaskDefinitionCommandInput;
    const env = registerInput.containerDefinitions?.[0]?.environment;

    // Hub-only vars propagate
    expect(env).toContainEqual({ name: "JVM_ARGS", value: "-Xmx512m" });
    expect(env).toContainEqual({ name: "CUSTOM_VAR", value: "customer-value" });
    // Test-specific var overrides hub value
    expect(env).toContainEqual({ name: "TEST_TYPE", value: "jmeter" });
    expect(env).not.toContainEqual({ name: "TEST_TYPE", value: "hub-default" });
  });

  it("should exclude hub env entries with null or undefined values", async () => {
    const hubContainerWithNulls = {
      ...HUB_CONTAINER,
      environment: [
        { name: "VALID", value: "keep" },
        { name: "NULL_VALUE", value: null },
        { name: undefined, value: "no-name" },
      ],
    };
    mockHubSend.mockResolvedValueOnce({
      taskDefinition: { ...HUB_TASK_DEF, containerDefinitions: [hubContainerWithNulls] },
    });
    mockSpokeSend.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: "arn:aws:ecs:us-west-2:123456789:task-definition/dlt-worker-test-abc123:1",
        revision: 1,
      },
    });

    await createTestTaskDefinition(baseParams());

    const registerInput = spokeCallInput(0) as RegisterTaskDefinitionCommandInput;
    const env = registerInput.containerDefinitions?.[0]?.environment;

    expect(env).toContainEqual({ name: "VALID", value: "keep" });
    expect(env?.find(e => e.name === "NULL_VALUE")).toBeUndefined();
    expect(env?.find(e => e.value === "no-name")).toBeUndefined();
  });

  it("should use hub container shape but NOT hub roles", async () => {
    mockHubSend.mockResolvedValueOnce({ taskDefinition: HUB_TASK_DEF });
    mockSpokeSend.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: "arn:aws:ecs:us-west-2:123456789:task-definition/dlt-worker-test-abc123:1",
        revision: 1,
      },
    });

    await createTestTaskDefinition(baseParams());

    const registerInput = spokeCallInput(0) as RegisterTaskDefinitionCommandInput;
    // Roles must come from spoke, NOT from hub
    expect(registerInput.taskRoleArn).not.toBe(HUB_TASK_DEF.taskRoleArn);
    expect(registerInput.executionRoleArn).not.toBe(HUB_TASK_DEF.executionRoleArn);
    // But container shape comes from hub
    expect(registerInput.containerDefinitions?.[0]?.healthCheck).toEqual(HUB_CONTAINER.healthCheck);
    expect(registerInput.networkMode).toBe(HUB_TASK_DEF.networkMode);
  });
});
