// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForStartSignal } from "../../src/s3/wait-for-start.js";

// Resolve poll delays immediately, but honor an already-aborted signal so the
// abort-between-polls cases still reject as they would in production.
vi.mock("node:timers/promises", () => ({
  setTimeout: (_ms: number, _val: unknown, opts?: { signal?: AbortSignal }) => {
    opts?.signal?.throwIfAborted();
    return Promise.resolve();
  },
}));

const s3Mock = mockClient(S3Client);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Parameters<typeof waitForStartSignal>[0]["logger"];
}

function makeNotFound(): NotFound {
  return new NotFound({ $metadata: { httpStatusCode: 404 }, message: "Not Found" });
}

function neverAbort(): AbortSignal {
  return new AbortController().signal;
}

describe("waitForStartSignal", () => {
  let s3: S3Client;

  beforeEach(() => {
    s3Mock.reset();
    s3 = new S3Client({ region: "us-east-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns immediately when the start marker already exists", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});

    await waitForStartSignal({
      s3,
      bucket: "bkt",
      testId: "T1",
      prefix: "P1",
      awsRegion: "us-east-1",
      signal: neverAbort(),
      logger: makeLogger(),
    });

    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(1);
  });

  it("builds the start-signal key correctly", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});

    await waitForStartSignal({
      s3,
      bucket: "scenarios-bucket",
      testId: "ABCD",
      prefix: "2026-05-07_run-1",
      awsRegion: "eu-west-1",
      signal: neverAbort(),
      logger: makeLogger(),
    });

    const call = s3Mock.commandCalls(HeadObjectCommand)[0];
    expect(call?.args[0].input.Bucket).toBe("scenarios-bucket");
    expect(call?.args[0].input.Key).toBe("start-signal/ABCD/2026-05-07_run-1/eu-west-1/start");
  });

  it("retries on NotFound until the marker appears", async () => {
    s3Mock
      .on(HeadObjectCommand)
      .rejectsOnce(makeNotFound())
      .rejectsOnce(makeNotFound())
      .rejectsOnce(makeNotFound())
      .resolves({});

    await waitForStartSignal({
      s3,
      bucket: "bkt",
      testId: "T1",
      prefix: "P1",
      awsRegion: "us-east-1",
      signal: neverAbort(),
      logger: makeLogger(),
    });

    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(4);
  });

  it("logs a warning and retries on transient S3 errors", async () => {
    const logger = makeLogger();
    s3Mock.on(HeadObjectCommand).rejectsOnce(new Error("ServiceUnavailable")).resolves({});

    await waitForStartSignal({
      s3,
      bucket: "bkt",
      testId: "T1",
      prefix: "P1",
      awsRegion: "us-east-1",
      signal: neverAbort(),
      logger,
    });

    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("aborts when the signal is already aborted before the first attempt", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForStartSignal({
        s3,
        bucket: "bkt",
        testId: "T1",
        prefix: "P1",
        awsRegion: "us-east-1",
        signal: controller.signal,
        logger: makeLogger(),
      })
    ).rejects.toThrow();
    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(0);
  });

  it("aborts the wait between polls when the signal fires", async () => {
    const controller = new AbortController();
    s3Mock.on(HeadObjectCommand).callsFake(() => {
      controller.abort();
      return Promise.reject(makeNotFound());
    });

    await expect(
      waitForStartSignal({
        s3,
        bucket: "bkt",
        testId: "T1",
        prefix: "P1",
        awsRegion: "us-east-1",
        signal: controller.signal,
        logger: makeLogger(),
      })
    ).rejects.toThrow();
  });

  it("logs info once when the start signal is received", async () => {
    const logger = makeLogger();
    s3Mock.on(HeadObjectCommand).rejectsOnce(makeNotFound()).resolves({});

    await waitForStartSignal({
      s3,
      bucket: "bkt",
      testId: "T1",
      prefix: "P1",
      awsRegion: "us-east-1",
      signal: neverAbort(),
      logger,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ key: "start-signal/T1/P1/us-east-1/start" }, "start signal received");
  });
});
