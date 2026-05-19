// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { START_SIGNAL_PREFIX, writeStartMarker } from "../src/start-command.js";

const s3Mock = mockClient(S3Client);

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendKeys: vi.fn(),
  } as unknown as import("@amzn/dlt-common").Logger;
}

describe("writeStartMarker", () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it("should write an empty S3 object at the correct key", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const logger = makeMockLogger();

    const result = await writeStartMarker({
      s3: new S3Client({}),
      bucket: "dlt-scenarios-bucket",
      testId: "test-abc123",
      prefix: "2025-01-01T00-00-00_abc",
      region: "us-west-2",
      logger,
    });

    expect(result.s3Key).toBe("start-signal/test-abc123/2025-01-01T00-00-00_abc/us-west-2/start");

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0]?.args[0].input;
    expect(input).toEqual({
      Bucket: "dlt-scenarios-bucket",
      Key: "start-signal/test-abc123/2025-01-01T00-00-00_abc/us-west-2/start",
      Body: "",
    });
  });

  it("should propagate S3 errors", async () => {
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 access denied"));
    const logger = makeMockLogger();

    await expect(
      writeStartMarker({
        s3: new S3Client({}),
        bucket: "dlt-scenarios-bucket",
        testId: "test-abc123",
        prefix: "2025-01-01T00-00-00_abc",
        region: "us-east-1",
        logger,
      })
    ).rejects.toThrow("S3 access denied");
  });

  it("should export START_SIGNAL_PREFIX constant", () => {
    expect(START_SIGNAL_PREFIX).toBe("start-signal");
  });
});
