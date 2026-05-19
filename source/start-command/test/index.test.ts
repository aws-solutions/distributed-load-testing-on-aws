// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/start-command.js", () => ({
  writeStartMarker: vi.fn(),
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
        SCENARIOS_BUCKET: "dlt-scenarios-bucket",
        MAIN_STACK_REGION: "us-east-1",
        AWS_ACCOUNT_ID: "123456789012",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
    sendOperationalMetric: vi.fn(),
  };
});

import { sendOperationalMetric } from "@amzn/dlt-common";
import { handler } from "../src/index.js";
import { writeStartMarker } from "../src/start-command.js";

const mockWriteStartMarker = vi.mocked(writeStartMarker);
const mockSendOperationalMetric = vi.mocked(sendOperationalMetric);

function makeEvent() {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    prefix: "2025-01-01T00-00-00_abc",
    testTaskConfig: {
      region: "us-west-2",
      taskCluster: "dlt-cluster",
      taskCount: 10,
      subnetA: "subnet-aaa",
      subnetB: "subnet-bbb",
      taskSecurityGroup: "sg-123",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role",
      executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role",
    },
    serviceName: "dlt-test-abc123-us-west-2",
    serviceArn: "arn:aws:ecs:us-west-2:123456789:service/dlt-cluster/dlt-test-abc123-us-west-2",
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should write S3 start marker and return the key", async () => {
    const expectedKey = "start-signal/test-abc123/2025-01-01T00-00-00_abc/us-west-2/start";
    mockWriteStartMarker.mockResolvedValue({ s3Key: expectedKey });

    const result = await handler(makeEvent());

    expect(result.s3Key).toBe(expectedKey);
    expect(mockWriteStartMarker).toHaveBeenCalledOnce();
    expect(mockWriteStartMarker).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "dlt-scenarios-bucket",
        testId: "test-abc123",
        prefix: "2025-01-01T00-00-00_abc",
        region: "us-west-2",
      })
    );
  });

  it("should send operational metric after writing marker", async () => {
    mockWriteStartMarker.mockResolvedValue({ s3Key: "start-signal/test-abc123/pfx/us-west-2/start" });

    await handler(makeEvent());

    expect(mockSendOperationalMetric).toHaveBeenCalledOnce();
    expect(mockSendOperationalMetric).toHaveBeenCalledWith(
      expect.objectContaining({ solutionId: "SO0062" }),
      expect.objectContaining({
        Type: "StartCommandSent",
        TestId: "test-abc123",
        TestRunId: "run-001",
        Region: "us-west-2",
      })
    );
  });

  it("should propagate errors from writeStartMarker", async () => {
    mockWriteStartMarker.mockRejectedValue(new Error("S3 write failed"));

    await expect(handler(makeEvent())).rejects.toThrow("S3 write failed");
  });
});
