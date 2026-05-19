// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { CreateServiceCommandInput } from "@aws-sdk/client-ecs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateEcsServiceParams } from "../src/service.js";
import { createEcsService } from "../src/service.js";

const mockSend = vi.fn<(command: { input: unknown }) => Promise<unknown>>();

const mockEcs = { send: mockSend } as unknown as import("@aws-sdk/client-ecs").ECSClient;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
};

function baseParams(overrides?: Partial<CreateEcsServiceParams>): CreateEcsServiceParams {
  return {
    ecs: mockEcs,
    cluster: "dlt-cluster",
    serviceName: "dlt-test-abc123-us-east-1",
    taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1",
    desiredCount: 10,
    subnets: ["subnet-aaa", "subnet-bbb"],
    securityGroup: "sg-123",
    testId: "test-abc123",
    testRunId: "run-001",
    solutionId: "SO0062",
    logger: mockLogger as never,
    ...overrides,
  };
}

/** Helper to extract command input from mockSend call history. */
function callInput(callIndex: number): unknown {
  const call = mockSend.mock.calls[callIndex];
  if (!call) throw new Error(`Expected mockSend call at index ${callIndex}`);
  return call[0].input;
}

describe("createEcsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an ECS service and return the ARN and name", async () => {
    mockSend.mockResolvedValueOnce({
      service: {
        serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
        serviceName: "dlt-test-abc123-us-east-1",
      },
    });

    const result = await createEcsService(baseParams());

    expect(result.serviceArn).toBe("arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1");
    expect(result.serviceName).toBe("dlt-test-abc123-us-east-1");
  });

  it("should pass correct parameters to CreateServiceCommand", async () => {
    mockSend.mockResolvedValueOnce({
      service: {
        serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
        serviceName: "dlt-test-abc123-us-east-1",
      },
    });

    await createEcsService(baseParams());

    const input = callInput(0) as CreateServiceCommandInput;

    expect(input.cluster).toBe("dlt-cluster");
    expect(input.serviceName).toBe("dlt-test-abc123-us-east-1");
    expect(input.taskDefinition).toBe("arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1");
    expect(input.desiredCount).toBe(10);
    expect(input.launchType).toBe("FARGATE");
    expect(input.networkConfiguration?.awsvpcConfiguration?.assignPublicIp).toBe("ENABLED");
    expect(input.networkConfiguration?.awsvpcConfiguration?.securityGroups).toEqual(["sg-123"]);
    expect(input.networkConfiguration?.awsvpcConfiguration?.subnets).toEqual(["subnet-aaa", "subnet-bbb"]);
    expect(input.deploymentConfiguration?.deploymentCircuitBreaker).toEqual({
      enable: true,
      rollback: false,
    });
    expect(input.enableECSManagedTags).toBe(true);
    expect(input.propagateTags).toBe("TASK_DEFINITION");
    expect(input.tags).toEqual([
      { key: "SolutionId", value: "SO0062" },
      { key: "TestId", value: "test-abc123" },
      { key: "TestRunId", value: "run-001" },
    ]);
  });

  it("should throw if no service ARN is returned", async () => {
    mockSend.mockResolvedValueOnce({ service: { serviceArn: undefined } });

    await expect(createEcsService(baseParams())).rejects.toThrow("no ARN returned");
  });

  it("should throw if service response is null", async () => {
    mockSend.mockResolvedValueOnce({ service: undefined });

    await expect(createEcsService(baseParams())).rejects.toThrow("no ARN returned");
  });

  it("should propagate ECS API errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("Service limit exceeded"));

    await expect(createEcsService(baseParams())).rejects.toThrow("Service limit exceeded");
  });
});
