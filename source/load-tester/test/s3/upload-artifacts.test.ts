// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadArtifacts } from "../../src/s3/upload-artifacts.js";

const s3Mock = mockClient(S3Client);

interface LogCall {
  readonly level: "info" | "warn" | "error";
  readonly data: Record<string, unknown>;
  readonly message: string;
}

function makeLogger(): {
  logger: Parameters<typeof uploadArtifacts>[0]["logger"];
  calls: LogCall[];
} {
  const calls: LogCall[] = [];
  const record = (level: "info" | "warn" | "error") => (data: Record<string, unknown>, message: string) => {
    calls.push({ level, data, message });
  };
  const stub = {
    info: vi.fn(record("info")),
    warn: vi.fn(record("warn")),
    error: vi.fn(record("error")),
  };
  return {
    logger: stub as unknown as Parameters<typeof uploadArtifacts>[0]["logger"],
    calls,
  };
}

describe("uploadArtifacts", () => {
  let artifactsDir: string;
  let s3: S3Client;

  beforeEach(async () => {
    artifactsDir = await mkdtemp(join(tmpdir(), "dlt-upload-test-"));
    s3Mock.reset();
    s3 = new S3Client({ region: "us-east-1" });
  });

  afterEach(async () => {
    await rm(artifactsDir, { recursive: true, force: true });
  });

  it("uploads every file in the artifacts dir under keyPrefix", async () => {
    await writeFile(join(artifactsDir, "results.xml"), "<FinalStatus/>");
    await writeFile(join(artifactsDir, "kpi.jtl"), "timeStamp,elapsed\n");
    s3Mock.on(PutObjectCommand).resolves({});

    const { logger, calls } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "results/abc/prefix/us-east-1/taskid",
      artifactsDir,
      logger,
    });

    const put = s3Mock.commandCalls(PutObjectCommand);
    expect(put).toHaveLength(2);
    const keys = put.map((c) => c.args[0].input.Key).sort();
    expect(keys).toEqual([
      "results/abc/prefix/us-east-1/taskid/kpi.jtl",
      "results/abc/prefix/us-east-1/taskid/results.xml",
    ]);
    expect(calls.filter((c) => c.level === "info")).toHaveLength(2);
  });

  it("sets the correct bucket and content length for each upload", async () => {
    await writeFile(join(artifactsDir, "small.txt"), "hi");
    s3Mock.on(PutObjectCommand).resolves({});

    const { logger } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      logger,
    });

    const put = s3Mock.commandCalls(PutObjectCommand);
    expect(put[0]?.args[0].input.Bucket).toBe("my-bucket");
    expect(put[0]?.args[0].input.ContentLength).toBe(2);
  });

  it("uploads large files as sequential multipart parts", async () => {
    const largeArtifact = join(artifactsDir, "large.jtl");
    await writeFile(largeArtifact, "");
    await truncate(largeArtifact, 5 * 1024 * 1024 + 1);
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-id" });

    let activeParts = 0;
    let maxActiveParts = 0;
    s3Mock.on(UploadPartCommand).callsFake(async () => {
      activeParts += 1;
      maxActiveParts = Math.max(maxActiveParts, activeParts);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeParts -= 1;
      return { ETag: "etag" };
    });
    s3Mock.on(CompleteMultipartUploadCommand).resolves({});

    const { logger } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      logger,
    });

    expect(s3Mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(UploadPartCommand)).toHaveLength(2);
    expect(s3Mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(1);
    expect(maxActiveParts).toBe(1);
  });

  it("aborts a failed multipart upload", async () => {
    const largeArtifact = join(artifactsDir, "large.jtl");
    await writeFile(largeArtifact, "");
    await truncate(largeArtifact, 5 * 1024 * 1024 + 1);
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-id" });
    s3Mock.on(UploadPartCommand).rejects(new Error("S3 rejected part"));
    s3Mock.on(AbortMultipartUploadCommand).resolves({});

    const { logger, calls } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      logger,
    });

    expect(s3Mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(1);
    expect(calls.filter((call) => call.level === "error")).toHaveLength(1);
  });

  it("returns normally when the artifacts dir is empty", async () => {
    const { logger, calls } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      logger,
    });

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("continues after a single upload failure, logging an error for the failed one", async () => {
    await writeFile(join(artifactsDir, "a.txt"), "a");
    await writeFile(join(artifactsDir, "b.txt"), "b");
    await writeFile(join(artifactsDir, "c.txt"), "c");
    s3Mock
      .on(PutObjectCommand, { Key: "prefix/a.txt" })
      .resolves({})
      .on(PutObjectCommand, { Key: "prefix/b.txt" })
      .rejects(new Error("S3 rejected"))
      .on(PutObjectCommand, { Key: "prefix/c.txt" })
      .resolves({});

    const { logger, calls } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      logger,
    });

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(3);
    const errors = calls.filter((c) => c.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data["name"]).toBe("b.txt");
  });

  it("logs an error for every file that fails to upload, required or not", async () => {
    await writeFile(join(artifactsDir, "a.txt"), "a");
    await writeFile(join(artifactsDir, "b.txt"), "b");
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 rejected"));

    const { logger, calls } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      logger,
    });

    const errors = calls.filter((c) => c.level === "error");
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.data["name"]).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("logs error when a required file is missing from the artifacts dir", async () => {
    await writeFile(join(artifactsDir, "present.txt"), "x");
    s3Mock.on(PutObjectCommand).resolves({});

    const { logger, calls } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      requiredFiles: ["present.txt", "results.xml"],
      logger,
    });

    const errors = calls.filter((c) => c.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data["requiredFile"]).toBe("results.xml");
  });

  it("logs a single upload error when a required file fails to upload", async () => {
    await writeFile(join(artifactsDir, "results.xml"), "<FinalStatus/>");
    s3Mock.on(PutObjectCommand).rejects(new Error("access denied"));

    const { logger, calls } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      requiredFiles: ["results.xml"],
      logger,
    });

    const errors = calls.filter((c) => c.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data["name"]).toBe("results.xml");
  });

  it("uploads required results before optional raw data", async () => {
    await writeFile(join(artifactsDir, "result.json"), "{}");
    await writeFile(join(artifactsDir, "kpi.json"), "{}");
    await writeFile(join(artifactsDir, "kpi.csv"), "csv");
    s3Mock.on(PutObjectCommand).resolves({});

    const { logger } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      requiredFiles: ["result.json"],
      logger,
    });

    const keys = s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key);
    expect(keys).toEqual(["prefix/result.json", "prefix/kpi.csv", "prefix/kpi.json"]);
  });

  it("skips directories without uploading them", async () => {
    await mkdir(join(artifactsDir, "__pycache__"));
    await mkdir(join(artifactsDir, "nested-dir"));
    await writeFile(join(artifactsDir, "good.txt"), "ok");
    s3Mock.on(PutObjectCommand).resolves({});

    const { logger } = makeLogger();
    await uploadArtifacts({
      s3,
      bucket: "my-bucket",
      keyPrefix: "prefix",
      artifactsDir,
      logger,
    });

    const putKeys = s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key);
    expect(putKeys).toEqual(["prefix/good.txt"]);
  });
});
