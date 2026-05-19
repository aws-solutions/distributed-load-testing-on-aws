// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependency modules before importing handler
vi.mock("../src/stabilization-check.js", () => ({
  checkStabilization: vi.fn(),
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
    getAwsClientConfig: vi.fn(() => ({})),
    getRequiredEnv: vi.fn((name: string) => {
      const envMap: Record<string, string> = {
        SOLUTION_ID: "SO0062",
        VERSION: "0.0.0",
        UUID: "test-uuid",
        METRIC_URL: "https://metrics.example.com",
        AWS_ACCOUNT_ID: "123456789012",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
    sendOperationalMetric: vi.fn(),
  };
});

import { handler } from "../src/index.js";
import { checkStabilization } from "../src/stabilization-check.js";

const mockCheckStabilization = vi.mocked(checkStabilization);

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testType: "simple" as const,
    fileType: "none",
    showLive: true,
    testDuration: 300,
    prefix: "2025-01-01T00-00-00_abc",
    testTaskConfig: {
      region: "us-east-1",
      taskCluster: "dlt-cluster",
      taskCount: 5,
      subnetA: "subnet-aaa",
      subnetB: "subnet-bbb",
      taskSecurityGroup: "sg-123",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role",
      executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role",
    },
    serviceName: "dlt-test-abc123-us-east-1",
    serviceArn: "arn:aws:ecs:us-east-1:123456789:service/dlt-cluster/dlt-test-abc123-us-east-1",
    taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-worker-test-abc123:1",
    taskDefinitionFamily: "dlt-worker-test-abc123",
    desiredCount: 5,
    ...overrides,
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:10:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return READY when service is stable", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: true,
      isFailed: false,
      runningCount: 5,
    });

    const result = await handler(makeEvent());

    expect(result.status).toBe("READY");
    expect(result.runningCount).toBe(5);
    expect(result.readyTimestamp).toBeGreaterThan(0);
  });

  it("should return PENDING when service is still stabilizing", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: false,
      isFailed: false,
      runningCount: 3,
    });

    const result = await handler(makeEvent());

    expect(result.status).toBe("PENDING");
    expect(result.runningCount).toBe(3);
    expect(result.readyTimestamp).toBe(0);
  });

  it("should return FAILED when circuit breaker triggers", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: false,
      isFailed: true,
      runningCount: 2,
      errorMessage: "Circuit breaker triggered",
    });

    const result = await handler(makeEvent());

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe("Circuit breaker triggered");
  });

  it("should set stabilizationStartTime on first invocation", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: false,
      isFailed: false,
      runningCount: 1,
    });

    const result = await handler(makeEvent());

    expect(result.stabilizationStartTime).toBe(Date.now());
  });

  it("should preserve stabilizationStartTime from previous PENDING result", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: false,
      isFailed: false,
      runningCount: 3,
    });

    const previousStartTime = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const result = await handler(makeEvent({ stabilizationStartTime: previousStartTime }));

    expect(result.stabilizationStartTime).toBe(previousStartTime);
  });

  it("should return FAILED after 30-minute timeout", async () => {
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;

    const result = await handler(makeEvent({ stabilizationStartTime: thirtyOneMinutesAgo }));

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toContain("30 minutes");
    // Should not even call checkStabilization
    expect(mockCheckStabilization).not.toHaveBeenCalled();
  });

  it("should NOT timeout at exactly 29 minutes", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: false,
      isFailed: false,
      runningCount: 4,
    });

    const twentyNineMinutesAgo = Date.now() - 29 * 60 * 1000;
    const result = await handler(makeEvent({ stabilizationStartTime: twentyNineMinutesAgo }));

    expect(result.status).toBe("PENDING");
    expect(mockCheckStabilization).toHaveBeenCalledOnce();
  });

  it("should pass through all event fields", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: false,
      isFailed: false,
      runningCount: 2,
    });

    const result = await handler(makeEvent());

    expect(result.testId).toBe("test-abc123");
    expect(result.testRunId).toBe("run-001");
    expect(result.testType).toBe("simple");
    expect(result.fileType).toBe("none");
    expect(result.showLive).toBe(true);
    expect(result.testDuration).toBe(300);
    expect(result.prefix).toBe("2025-01-01T00-00-00_abc");
    expect(result.serviceName).toBe("dlt-test-abc123-us-east-1");
    expect(result.desiredCount).toBe(5);
  });

  it("should not include errorMessage for FAILED status without error", async () => {
    mockCheckStabilization.mockResolvedValue({
      isStable: false,
      isFailed: true,
      runningCount: 0,
    });

    const result = await handler(makeEvent());

    expect(result.status).toBe("FAILED");
    expect("errorMessage" in result).toBe(false);
  });
});
