// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { monitorCompletion } from "../src/completion.js";

const s3Mock = mockClient(S3Client);

function makeS3(): S3Client {
  return new S3Client({ region: "us-east-1" });
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
};

describe("monitorCompletion", () => {
  beforeEach(() => {
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it("should return isComplete true when all tasks have markers", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      KeyCount: 5,
      IsTruncated: false,
    });

    const result = await monitorCompletion({
      s3: makeS3(),
      bucket: "dlt-bucket",
      testId: "test-abc123",
      prefix: "prefix-1",
      region: "us-east-1",
      desiredCount: 5,
      logger: mockLogger as never,
    });

    expect(result).toEqual({ completedTaskCount: 5, isComplete: true });
  });

  it("should return isComplete false when some tasks are still pending", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      KeyCount: 3,
      IsTruncated: false,
    });

    const result = await monitorCompletion({
      s3: makeS3(),
      bucket: "dlt-bucket",
      testId: "test-abc123",
      prefix: "prefix-1",
      region: "us-east-1",
      desiredCount: 5,
      logger: mockLogger as never,
    });

    expect(result).toEqual({ completedTaskCount: 3, isComplete: false });
  });

  it("should return isComplete true when no tasks are expected and none found", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      KeyCount: 0,
      IsTruncated: false,
    });

    const result = await monitorCompletion({
      s3: makeS3(),
      bucket: "dlt-bucket",
      testId: "test-abc123",
      prefix: "prefix-1",
      region: "us-east-1",
      desiredCount: 0,
      logger: mockLogger as never,
    });

    expect(result).toEqual({ completedTaskCount: 0, isComplete: true });
  });

  it("should handle pagination across multiple pages", async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({
        KeyCount: 1000,
        IsTruncated: true,
        NextContinuationToken: "token-page-2",
      })
      .resolvesOnce({
        KeyCount: 500,
        IsTruncated: false,
      });

    const result = await monitorCompletion({
      s3: makeS3(),
      bucket: "dlt-bucket",
      testId: "test-abc123",
      prefix: "prefix-1",
      region: "us-east-1",
      desiredCount: 1500,
      logger: mockLogger as never,
    });

    expect(result).toEqual({ completedTaskCount: 1500, isComplete: true });

    const calls = s3Mock.commandCalls(ListObjectsV2Command);
    expect(calls).toHaveLength(2);

    // Second call should include continuation token
    const secondInput = calls[1]?.args[0].input;
    expect(secondInput?.ContinuationToken).toBe("token-page-2");
  });

  it("should use correct S3 prefix with region", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      KeyCount: 0,
      IsTruncated: false,
    });

    await monitorCompletion({
      s3: makeS3(),
      bucket: "my-bucket",
      testId: "test-xyz",
      prefix: "run-42",
      region: "eu-west-1",
      desiredCount: 10,
      logger: mockLogger as never,
    });

    const calls = s3Mock.commandCalls(ListObjectsV2Command);
    expect(calls).toHaveLength(1);

    const input = calls[0]?.args[0].input;
    expect(input).toEqual({
      Bucket: "my-bucket",
      Prefix: "results/test-xyz/run-42/completion/eu-west-1/",
      ContinuationToken: undefined,
    });
  });

  it("should return isComplete true when count exceeds desired (extra markers)", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      KeyCount: 12,
      IsTruncated: false,
    });

    const result = await monitorCompletion({
      s3: makeS3(),
      bucket: "dlt-bucket",
      testId: "test-abc123",
      prefix: "prefix-1",
      region: "us-east-1",
      desiredCount: 10,
      logger: mockLogger as never,
    });

    expect(result).toEqual({ completedTaskCount: 12, isComplete: true });
  });

  it("should treat missing KeyCount as zero", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      IsTruncated: false,
    });

    const result = await monitorCompletion({
      s3: makeS3(),
      bucket: "dlt-bucket",
      testId: "test-abc123",
      prefix: "prefix-1",
      region: "us-east-1",
      desiredCount: 5,
      logger: mockLogger as never,
    });

    expect(result).toEqual({ completedTaskCount: 0, isComplete: false });
  });

  it("should propagate S3 errors", async () => {
    s3Mock.on(ListObjectsV2Command).rejects(new Error("Access Denied"));

    await expect(
      monitorCompletion({
        s3: makeS3(),
        bucket: "dlt-bucket",
        testId: "test-abc123",
        prefix: "prefix-1",
        region: "us-east-1",
        desiredCount: 5,
        logger: mockLogger as never,
      })
    ).rejects.toThrow("Access Denied");
  });
});
