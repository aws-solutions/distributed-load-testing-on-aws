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

const baseInput = {
  bucket: "dlt-bucket",
  testId: "test-abc123",
  prefix: "prefix-1",
  region: "us-east-1",
  desiredCount: 3,
  logger: mockLogger as never,
};

describe("monitorCompletion", () => {
  beforeEach(() => {
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it("derives completion and warning counts for the current region", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      KeyCount: 3,
      Contents: [
        { Key: "results/test-abc123/prefix-1/completion/us-east-1/task-1" },
        { Key: "results/test-abc123/prefix-1/completion/us-east-1/task-2.warning" },
        { Key: "results/test-abc123/prefix-1/completion/us-east-1/task-3" },
      ],
    });

    await expect(monitorCompletion({ s3: makeS3(), ...baseInput })).resolves.toEqual({
      completedTaskCount: 3,
      isComplete: true,
      warningTaskCount: 1,
    });

    expect(s3Mock.commandCalls(ListObjectsV2Command)[0]?.args[0].input).toEqual({
      Bucket: "dlt-bucket",
      Prefix: "results/test-abc123/prefix-1/completion/us-east-1/",
      ContinuationToken: undefined,
    });
  });

  it("counts completion and warning markers across pages", async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({
        KeyCount: 2,
        Contents: [
          { Key: "results/test-abc123/prefix-1/completion/us-east-1/task-1" },
          { Key: "results/test-abc123/prefix-1/completion/us-east-1/task-2.warning" },
        ],
        IsTruncated: true,
        NextContinuationToken: "page-2",
      })
      .resolvesOnce({
        KeyCount: 1,
        Contents: [{ Key: "results/test-abc123/prefix-1/completion/us-east-1/task-3" }],
      });

    await expect(monitorCompletion({ s3: makeS3(), ...baseInput })).resolves.toEqual({
      completedTaskCount: 3,
      isComplete: true,
      warningTaskCount: 1,
    });

    expect(s3Mock.commandCalls(ListObjectsV2Command)[1]?.args[0].input.ContinuationToken).toBe("page-2");
  });

  it("supports old workers that write only normal markers", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      KeyCount: 2,
      Contents: [
        { Key: "results/test-abc123/prefix-1/completion/us-east-1/task-1" },
        { Key: "results/test-abc123/prefix-1/completion/us-east-1/task-2" },
      ],
    });

    await expect(monitorCompletion({ s3: makeS3(), ...baseInput })).resolves.toEqual({
      completedTaskCount: 2,
      isComplete: false,
      warningTaskCount: 0,
    });
  });

  it("returns complete when no tasks are expected", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({});

    await expect(monitorCompletion({ s3: makeS3(), ...baseInput, desiredCount: 0 })).resolves.toEqual({
      completedTaskCount: 0,
      isComplete: true,
      warningTaskCount: 0,
    });
  });

  it("propagates S3 errors", async () => {
    s3Mock.on(ListObjectsV2Command).rejects(new Error("Access Denied"));

    await expect(monitorCompletion({ s3: makeS3(), ...baseInput })).rejects.toThrow("Access Denied");
  });
});
