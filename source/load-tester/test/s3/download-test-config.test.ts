// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { downloadTestConfig } from "../../src/s3/download-test-config.js";

vi.mock("../../src/s3/download-to-file.js", () => ({
  downloadToFile: vi.fn().mockResolvedValue(undefined),
}));

import { downloadToFile } from "../../src/s3/download-to-file.js";
const downloadToFileMock = vi.mocked(downloadToFile);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Parameters<typeof downloadTestConfig>[0]["logger"];
}

describe("downloadTestConfig", () => {
  it("downloads the config file to the specified path", async () => {
    const s3 = new S3Client({ region: "us-east-1" });

    await downloadTestConfig({
      s3,
      bucket: "my-bucket",
      testId: "T1",
      testRegion: "eu-west-1",
      destPath: "/tmp/work/test-config.json",
      logger: makeLogger(),
    });

    expect(downloadToFileMock).toHaveBeenCalledWith({
      s3,
      bucket: "my-bucket",
      key: "test-scenarios/T1-eu-west-1.json",
      destPath: "/tmp/work/test-config.json",
    });
  });

  it("propagates download errors", async () => {
    downloadToFileMock.mockRejectedValueOnce(new Error("Access Denied"));
    const s3 = new S3Client({ region: "us-east-1" });

    await expect(
      downloadTestConfig({
        s3,
        bucket: "my-bucket",
        testId: "T1",
        testRegion: "us-east-1",
        destPath: "/tmp/config.json",
        logger: makeLogger(),
      })
    ).rejects.toThrow("Access Denied");
  });
});
