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
  // Real-ish error class so the handler's `instanceof` check behaves; the
  // failure-path DDB write distinguishes a conditional-check failure (skip)
  // from a genuine infra error (log).
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    constructor(opts?: { message?: string }) {
      super(opts?.message ?? "conditional check failed");
      this.name = "ConditionalCheckFailedException";
    }
  },
}));
vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn(),
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  UpdateCommand: vi.fn(),
}));

import { SETUP_ERROR_MESSAGES, SetupErrorCode } from "@amzn/dlt-common";

import { createDashboard } from "../src/dashboard.js";
import { handler } from "../src/index.js";
import { createEcsService } from "../src/service.js";
import { createTestTaskDefinition } from "../src/task-definition.js";

const mockCreateTaskDef = vi.mocked(createTestTaskDefinition);
const mockCreateService = vi.mocked(createEcsService);
const mockCreateDashboard = vi.mocked(createDashboard);

const NATIVE_TASK_DEFS = {
  k6: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-k6:2",
  locust: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-locust:3",
};

function makeEvent() {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testType: "jmeter" as const,
    fileType: "script" as const,
    showLive: true,
    testDuration: 300,
    prefix: "prefix-1",
    hubTaskDefinition: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
    nativeRunMode: null,
    nativeTaskDefinitions: NATIVE_TASK_DEFS,
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
      fileType: "script",
      showLive: true,
      testDuration: 300,
      prefix: "prefix-1",
      nativeRunMode: null,
      testTaskConfig: event.testTaskConfig,
      serviceName: "dlt-test-abc123-us-east-1",
      serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
      taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1",
      taskDefinitionFamily: "dlt-worker-test-abc123",
      desiredCount: 10,
    });
  });

  it("should preserve nativeRunMode in the TaskRunnerResult", async () => {
    const nativeRunMode = {
      maxTestDurationSeconds: 3600,
    };

    const result = await handler({
      ...makeEvent(),
      testType: "locust",
      nativeRunMode,
      nativeTaskDefinitions: NATIVE_TASK_DEFS,
    });

    expect(result.nativeRunMode).toEqual(nativeRunMode);
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

  it("returns a FAILED result (not a throw) on service creation failure", async () => {
    mockCreateService.mockRejectedValueOnce(new Error("Service limit exceeded"));

    const result = (await handler(makeEvent())) as { status?: string; errorMessage?: string };
    expect(result.status).toBe("FAILED");
    // "Service limit exceeded" classifies as a quota/limit failure.
    expect(result.errorMessage).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Quota]);
  });

  it("returns a FAILED result on task definition failure", async () => {
    mockCreateTaskDef.mockRejectedValueOnce(new Error("Task def not found"));

    const result = (await handler(makeEvent())) as { status?: string; errorMessage?: string };
    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Generic]);
  });

  it("writes a status-only failure update (no errorReason) and returns FAILED when dashboard creation fails", async () => {
    const { DynamoDBDocumentClient, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    const mockSend = vi.fn();
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockCreateDashboard.mockRejectedValueOnce(new Error("Dashboard widget limit"));

    const result = (await handler(makeEvent())) as { status?: string };
    expect(result.status).toBe("FAILED");
    // Two writes: queued→provisioning, then the fast status-only failure write.
    expect(mockSend).toHaveBeenCalledTimes(2);
    // The failure write sets status only — the reason is written once, later, by
    // the terminal step function write (single writer), not here.
    expect(UpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: "dlt-scenarios",
        Key: { testId: "test-abc123" },
        UpdateExpression: "SET #s = :failed",
      })
    );
  });

  it("returns FAILED even when the fast fail-status DDB write itself errors", async () => {
    const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
    const mockSend = vi.fn().mockRejectedValueOnce(new Error("DDB throttled"));
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockCreateService.mockRejectedValueOnce(new Error("Service limit exceeded"));

    // The fast fail-status write is best-effort; a DDB error there must not stop
    // the handler from returning the FAILED region result.
    const result = (await handler(makeEvent())) as { status?: string; errorMessage?: string };
    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Quota]);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("writes a guarded status-only failure update after taskDef registration, then returns FAILED", async () => {
    const { DynamoDBDocumentClient, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    const mockSend = vi.fn();
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockCreateService.mockRejectedValueOnce(new Error("Service limit exceeded"));

    const result = (await handler(makeEvent())) as { status?: string };
    expect(result.status).toBe("FAILED");

    // Task definition was registered before the service creation failure
    expect(mockCreateTaskDef).toHaveBeenCalledOnce();

    // One DDB write (error path only — provisioning update never reached), and it
    // is the guarded, status-only fast fail signal (no errorReason here).
    expect(mockSend).toHaveBeenCalledOnce();
    expect(UpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: "dlt-scenarios",
        Key: { testId: "test-abc123" },
        ConditionExpression: "attribute_not_exists(#s) OR #s IN (:queued, :provisioning)",
        UpdateExpression: "SET #s = :failed",
        ExpressionAttributeValues: expect.objectContaining({ ":failed": "failed" }) as Record<string, string>,
      })
    );
  });

  it("maps the ECS 'still Draining' failure to a clear, retryable reason on the returned result", async () => {
    mockCreateService.mockRejectedValueOnce(new Error("Unable to Start a service that is still Draining."));

    const result = (await handler(makeEvent())) as { status?: string; errorMessage?: string };
    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe(
      "A previous run's resources are still stopping. Please wait a few seconds and retry."
    );
  });

  it("maps a throttling failure to the throttling catalog reason on the returned result", async () => {
    const throttled = new Error("Rate exceeded");
    throttled.name = "ThrottlingException";
    mockCreateService.mockRejectedValueOnce(throttled);

    const result = (await handler(makeEvent())) as { status?: string; errorMessage?: string };
    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Throttling]);
  });

  it("maps an unrecognized failure to the generic catalog reason on the returned result", async () => {
    mockCreateService.mockRejectedValueOnce(new Error("some totally unexpected boom"));

    const result = (await handler(makeEvent())) as { status?: string; errorMessage?: string };
    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Generic]);
  });

  it("swallows a conditional-check failure on the fast fail-status write and still returns FAILED", async () => {
    // A healthy run owns the record: the guarded status-only write is rejected,
    // which must be swallowed while the handler still returns the FAILED result.
    const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
    const { ConditionalCheckFailedException } = await import("@aws-sdk/client-dynamodb");
    const mockSend = vi
      .fn()
      .mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: "conditional request failed", $metadata: {} })
      );
    vi.mocked(DynamoDBDocumentClient).from.mockReturnValue({ send: mockSend } as never);

    mockCreateService.mockRejectedValueOnce(new Error("Creation of service was not idempotent"));

    const result = (await handler(makeEvent())) as { status?: string };
    expect(result.status).toBe("FAILED");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  describe("native mode", () => {
    function makeNativeEvent(overrides: Record<string, unknown> = {}) {
      return {
        ...makeEvent(),
        testType: "locust" as const,
        nativeRunMode: { maxTestDurationSeconds: 3600 },
        nativeTaskDefinitions: NATIVE_TASK_DEFS,
        ...overrides,
      };
    }

    const envVarsFromCall = () => {
      const call = mockCreateTaskDef.mock.calls[0];
      if (!call) throw new Error("Expected createTestTaskDefinition call");
      return call[0].envVars;
    };

    const taskDefFromCall = () => {
      const call = mockCreateTaskDef.mock.calls[0];
      if (!call) throw new Error("Expected createTestTaskDefinition call");
      return call[0].hubTaskDefinition;
    };

    it("uses the task definition matching the test's framework", async () => {
      await handler(makeNativeEvent());

      expect(taskDefFromCall()).toBe(NATIVE_TASK_DEFS.locust);
    });

    it("uses the k6 task definition for a native k6 test", async () => {
      await handler(makeNativeEvent({ testType: "k6" as const }));

      expect(taskDefFromCall()).toBe(NATIVE_TASK_DEFS.k6);
    });

    it("runs a simple test on locust", async () => {
      await handler(makeNativeEvent({ testType: "simple" as const }));

      expect(taskDefFromCall()).toBe(NATIVE_TASK_DEFS.locust);
    });

    it("uses the Taurus task definition in legacy mode", async () => {
      await handler(makeEvent());

      expect(taskDefFromCall()).toBe("arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1");
    });

    // createDashboard parses the space-delimited Taurus console line, which
    // native containers never emit, so the widgets would be empty and the
    // metric filters inert.
    it("does not create the CloudWatch dashboard", async () => {
      await handler(makeNativeEvent());

      expect(mockCreateDashboard).not.toHaveBeenCalled();
    });

    it("returns FAILED when the framework has no task definition", async () => {
      const result = (await handler(makeNativeEvent({ nativeTaskDefinitions: {} }))) as {
        status?: string;
        errorMessage?: string;
      };
      expect(result.status).toBe("FAILED");
      expect(result.errorMessage).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Generic]);
    });

    it("passes the max duration to the container", async () => {
      await handler(makeNativeEvent());

      expect(envVarsFromCall()["MAX_DURATION_SECONDS"]).toBe("3600");
    });

    it("sets only the max duration for a native locust test — no load vars", async () => {
      await handler(makeNativeEvent());

      const envVars = envVarsFromCall();
      expect(envVars["MAX_DURATION_SECONDS"]).toBe("3600");
      expect(Object.keys(envVars).filter((key) => key.startsWith("DLT_"))).toEqual([]);
    });

    it("sets only the max duration for a native k6 test — no load vars", async () => {
      await handler(makeNativeEvent({ testType: "k6" as const }));

      const envVars = envVarsFromCall();
      expect(envVars["MAX_DURATION_SECONDS"]).toBe("3600");
      expect(Object.keys(envVars).filter((key) => key.startsWith("DLT_"))).toEqual([]);
    });

    it("passes only the max duration for a native JMeter test", async () => {
      await handler(
        makeNativeEvent({
          testType: "jmeter" as const,
          nativeTaskDefinitions: {
            ...NATIVE_TASK_DEFS,
            jmeter: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-jmeter:1",
          },
        })
      );

      const envVars = envVarsFromCall();
      expect(envVars["MAX_DURATION_SECONDS"]).toBe("3600");
      expect(Object.keys(envVars).filter((key) => key.startsWith("DLT_"))).toEqual([]);
    });

    it("leaves the container environment untouched in legacy mode", async () => {
      await handler(makeEvent());

      const envVars = envVarsFromCall();
      expect(envVars).not.toHaveProperty("MAX_DURATION_SECONDS");
      expect(envVars).not.toHaveProperty("DLT_LOCUST_USERS");
    });
  });
});
