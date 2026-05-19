// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock S3Client and commands
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () {
    return { send: mockSend };
  }),
  ListObjectsV2Command: vi.fn(function (input: unknown) {
    return { input };
  }),
  GetObjectCommand: vi.fn(function (input: unknown) {
    return { input };
  }),
}));

// Mock fs
vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(() => {
    const { PassThrough } = require("node:stream");
    return new PassThrough();
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

// Mock stream/promises
vi.mock("node:stream/promises", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock archiver
vi.mock("archiver", () => {
  return {
    default: vi.fn(() => {
      const { EventEmitter } = require("node:events");
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        pipe: vi.fn(),
        append: vi.fn(),
        finalize: vi.fn().mockResolvedValue(undefined),
      });
    }),
  };
});

import {
  filterFiles,
  buildArtifactPrefix,
  formatBytes,
  listArtifacts,
  resolveArtifactPrefix,
  createS3Client,
  type ArtifactFile,
} from "../../src/lib/artifact-downloader.js";
import { S3Client } from "@aws-sdk/client-s3";

const fakeCreds = {
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
  sessionToken: "TOKEN",
};

describe("artifact-downloader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatBytes", () => {
    it("formats bytes", () => {
      expect(formatBytes(500)).toBe("500 B");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(2048)).toBe("2.0 KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(1024 * 1024 * 3.5)).toBe("3.5 MB");
    });

    it("formats edge case at 1024", () => {
      expect(formatBytes(1024)).toBe("1.0 KB");
    });
  });

  describe("filterFiles", () => {
    const files: ArtifactFile[] = [
      { key: "a/results.xml", relativePath: "results.xml", size: 100 },
      { key: "a/results.json", relativePath: "results.json", size: 200 },
      { key: "a/sub/data.xml", relativePath: "sub/data.xml", size: 300 },
      { key: "a/image.png", relativePath: "image.png", size: 400 },
    ];

    it("filters by *.xml pattern", () => {
      const result = filterFiles(files, "*.xml");
      expect(result).toHaveLength(2);
      expect(result[0]!.relativePath).toBe("results.xml");
      expect(result[1]!.relativePath).toBe("sub/data.xml");
    });

    it("filters by *.json pattern", () => {
      const result = filterFiles(files, "*.json");
      expect(result).toHaveLength(1);
      expect(result[0]!.relativePath).toBe("results.json");
    });

    it("matches with wildcard paths", () => {
      const result = filterFiles(files, "sub/*.xml");
      expect(result).toHaveLength(1);
      expect(result[0]!.relativePath).toBe("sub/data.xml");
    });

    it("returns empty array when nothing matches", () => {
      const result = filterFiles(files, "*.csv");
      expect(result).toHaveLength(0);
    });

    it("is case-insensitive", () => {
      const result = filterFiles(files, "*.PNG");
      expect(result).toHaveLength(1);
    });
  });

  describe("buildArtifactPrefix", () => {
    it("builds the correct prefix", () => {
      const prefix = buildArtifactPrefix("test-123", "2024-01-01 12:30:45", "run-abc");
      expect(prefix).toBe("results/test-123/2024-01-01T12-30-45_run-abc");
    });

    it("handles already-normalized startTime", () => {
      const prefix = buildArtifactPrefix("test-456", "2024-01-01T12-30-45", "run-xyz");
      expect(prefix).toBe("results/test-456/2024-01-01T12-30-45_run-xyz");
    });
  });

  describe("listArtifacts", () => {
    it("lists files from S3 with pagination", async () => {
      const client = new S3Client({});
      mockSend
        .mockResolvedValueOnce({
          Contents: [
            { Key: "results/t1/run/file1.xml", Size: 100 },
            { Key: "results/t1/run/file2.json", Size: 200 },
          ],
          IsTruncated: true,
          NextContinuationToken: "token-2",
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: "results/t1/run/file3.txt", Size: 50 }],
          IsTruncated: false,
        });

      const files = await listArtifacts("my-bucket", "results/t1/run", "us-east-1", fakeCreds, client);

      expect(files).toHaveLength(3);
      expect(files[0]!.relativePath).toBe("file1.xml");
      expect(files[1]!.relativePath).toBe("file2.json");
      expect(files[2]!.relativePath).toBe("file3.txt");
    });

    it("skips directory markers (Size=0)", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/run/", Size: 0 },
          { Key: "results/t1/run/file.xml", Size: 100 },
        ],
        IsTruncated: false,
      });

      const files = await listArtifacts("my-bucket", "results/t1/run", "us-east-1", fakeCreds, client);

      expect(files).toHaveLength(1);
      expect(files[0]!.relativePath).toBe("file.xml");
    });

    it("returns empty array when no Contents", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({ IsTruncated: false });

      const files = await listArtifacts("my-bucket", "results/t1/run/", "us-east-1", fakeCreds, client);

      expect(files).toHaveLength(0);
    });
  });

  describe("resolveArtifactPrefix", () => {
    it("returns exact prefix when it matches", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2024-01-01T12-30-45_run-abc/file.xml" }],
      });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        "2024-01-01 12:30:45",
        "run-abc",
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBe("results/t1/2024-01-01T12-30-45_run-abc");
    });

    it("falls back to searching CommonPrefixes when exact prefix misses", async () => {
      const client = new S3Client({});
      // First call: exact prefix not found
      mockSend.mockResolvedValueOnce({ Contents: [] });
      // Second call: search by delimiter
      mockSend.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: "results/t1/2024-01-01T12-31-00_run-abc/" }],
      });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        "2024-01-01 12:30:45",
        "run-abc",
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBe("results/t1/2024-01-01T12-31-00_run-abc");
    });

    it("returns null when no prefix found", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({ Contents: [] });
      mockSend.mockResolvedValueOnce({ CommonPrefixes: [] });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        "2024-01-01 12:30:45",
        "run-abc",
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBeNull();
    });
  });

  describe("createS3Client", () => {
    it("returns an S3Client instance", () => {
      const client = createS3Client("us-east-1", fakeCreds);
      expect(client).toBeDefined();
    });
  });
});
