// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadScript } from "../../src/s3/download-script.js";

vi.mock("../../src/s3/download-to-file.js", () => ({
  downloadToFile: vi.fn(),
}));

import { downloadToFile } from "../../src/s3/download-to-file.js";
const downloadToFileMock = vi.mocked(downloadToFile);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Parameters<typeof downloadScript>[0]["logger"];
}

function makeNoSuchKey(key: string): NoSuchKey {
  return new NoSuchKey({
    $metadata: { httpStatusCode: 404 },
    message: `The specified key does not exist: ${key}`,
  });
}

describe("downloadScript", () => {
  let s3: S3Client;

  beforeEach(() => {
    s3 = new S3Client({ region: "us-east-1" });
    downloadToFileMock.mockReset();
    downloadToFileMock.mockResolvedValue(undefined);
  });

  describe("jmeter", () => {
    it("downloads the .jmx file", async () => {
      const result = await downloadScript({
        s3,
        bucket: "bkt",
        testId: "ABCD1234",
        framework: "jmeter",
        fileType: "script",
        destDir: "/tmp/work",
        logger: makeLogger(),
      });

      expect(result.extension).toBe("jmx");
      expect(result.localPath).toBe("/tmp/work/ABCD1234.jmx");
      expect(downloadToFileMock).toHaveBeenCalledWith({
        s3,
        bucket: "bkt",
        key: "public/test-scenarios/jmeter/ABCD1234.jmx",
        destPath: "/tmp/work/ABCD1234.jmx",
      });
    });
  });

  describe("locust", () => {
    it("downloads the .py file", async () => {
      const result = await downloadScript({
        s3,
        bucket: "bkt",
        testId: "X1",
        framework: "locust",
        fileType: "script",
        destDir: "/tmp/work",
        logger: makeLogger(),
      });

      expect(result.extension).toBe("py");
      expect(downloadToFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ key: "public/test-scenarios/locust/X1.py" })
      );
    });
  });

  describe("k6", () => {
    it("downloads the .ts file when it exists", async () => {
      const result = await downloadScript({
        s3,
        bucket: "bkt",
        testId: "K1",
        framework: "k6",
        fileType: "script",
        destDir: "/tmp/work",
        logger: makeLogger(),
      });

      expect(result.extension).toBe("ts");
      expect(downloadToFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ key: "public/test-scenarios/k6/K1.ts" })
      );
    });

    it("falls back to .js when .ts is not found", async () => {
      downloadToFileMock
        .mockRejectedValueOnce(makeNoSuchKey("public/test-scenarios/k6/K1.ts"))
        .mockResolvedValueOnce(undefined);

      const result = await downloadScript({
        s3,
        bucket: "bkt",
        testId: "K1",
        framework: "k6",
        fileType: "script",
        destDir: "/tmp/work",
        logger: makeLogger(),
      });

      expect(result.extension).toBe("js");
      expect(downloadToFileMock).toHaveBeenCalledTimes(2);
      expect(downloadToFileMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ key: "public/test-scenarios/k6/K1.ts" })
      );
      expect(downloadToFileMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ key: "public/test-scenarios/k6/K1.js" })
      );
    });

    it("does not fall back on non-NoSuchKey errors", async () => {
      downloadToFileMock.mockRejectedValueOnce(new Error("AccessDenied"));

      await expect(
        downloadScript({
          s3,
          bucket: "bkt",
          testId: "K1",
          framework: "k6",
          fileType: "script",
          destDir: "/tmp/work",
          logger: makeLogger(),
        })
      ).rejects.toThrow("AccessDenied");
      expect(downloadToFileMock).toHaveBeenCalledTimes(1);
    });

    it("throws NoSuchKey when both .ts and .js are missing", async () => {
      downloadToFileMock.mockRejectedValueOnce(makeNoSuchKey("K1.ts")).mockRejectedValueOnce(makeNoSuchKey("K1.js"));

      await expect(
        downloadScript({
          s3,
          bucket: "bkt",
          testId: "K1",
          framework: "k6",
          fileType: "script",
          destDir: "/tmp/work",
          logger: makeLogger(),
        })
      ).rejects.toBeInstanceOf(NoSuchKey);
    });
  });

  describe("zip", () => {
    it.each(["jmeter", "k6", "locust"] as const)("downloads the .zip for %s", async (framework) => {
      const result = await downloadScript({
        s3,
        bucket: "bkt",
        testId: "Z1",
        framework,
        fileType: "zip",
        destDir: "/tmp/work",
        logger: makeLogger(),
      });

      expect(result.extension).toBe("zip");
      expect(downloadToFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ key: `public/test-scenarios/${framework}/Z1.zip` })
      );
    });
  });
});
