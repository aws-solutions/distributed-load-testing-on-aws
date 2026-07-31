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
    const stream = new PassThrough();
    // Emit 'close' after a tick so archiveFinished resolves
    process.nextTick(() => stream.emit("close"));
    return stream;
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
  const createMockArchive = () => {
    const { EventEmitter } = require("node:events");
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      pipe: vi.fn(),
      append: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
    });
  };
  return {
    // archiver 8 exposes named archive classes: new ZipArchive(options)
    ZipArchive: vi.fn(function () {
      return createMockArchive();
    }),
    default: vi.fn(() => createMockArchive()),
  };
});

// Mock prompt
vi.mock("../../src/lib/prompt.js", () => ({
  confirmOverwrite: vi.fn().mockResolvedValue(undefined),
}));

import {
  filterFiles,
  buildArtifactPrefix,
  formatBytes,
  listArtifacts,
  resolveArtifactPrefix,
  createS3Client,
  downloadArtifactsToDir,
  downloadArtifactsToZip,
  getArtifactInfo,
  downloadRunArtifacts,
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

  describe("downloadArtifactsToDir", () => {
    it("downloads files to local directory", async () => {
      const { Readable } = await import("node:stream");
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/file1.xml", relativePath: "file1.xml", size: 100 },
      ];

      mockSend.mockResolvedValueOnce({
        Body: Readable.from(["file content"]),
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client);
      consoleSpy.mockRestore();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("skips files with empty body", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/empty.xml", relativePath: "empty.xml", size: 0 },
      ];

      mockSend.mockResolvedValueOnce({ Body: undefined });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: empty body"));
      consoleSpy.mockRestore();
    });
  });

  describe("downloadArtifactsToZip", () => {
    it("downloads files into a zip archive", async () => {
      const { Readable } = await import("node:stream");
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/file1.xml", relativePath: "file1.xml", size: 100 },
      ];

      mockSend.mockResolvedValueOnce({
        Body: Readable.from(["file content"]),
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToZip("my-bucket", files, "/tmp/out.zip", "us-east-1", fakeCreds, client);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("file1.xml"));
      consoleSpy.mockRestore();
    });

    it("skips files with empty body", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/empty.xml", relativePath: "empty.xml", size: 0 },
      ];

      mockSend.mockResolvedValueOnce({ Body: undefined });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToZip("my-bucket", files, "/tmp/out.zip", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: empty body"));
      consoleSpy.mockRestore();
    });
  });

  describe("getArtifactInfo", () => {
    function createMockApi(runData: any, config?: any) {
      return {
        get: vi.fn().mockResolvedValue(runData),
        config: config ?? { scenariosBucket: "my-bucket", region: "us-east-1" },
        awsCredentialIdentity: fakeCreds,
      } as any;
    }

    it("resolves artifact prefix when startTime and scenariosBucket are present", async () => {
      // resolveArtifactPrefix: exact match found
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/file.xml" }],
      });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
        testType: "simple",
      });

      const info = await getArtifactInfo(api, "t1", "run-001");

      expect(info.testId).toBe("t1");
      expect(info.runId).toBe("run-001");
      expect(info.startTime).toBe("2025-01-15 10:30:00");
      expect(info.testType).toBe("simple");
      expect(info.artifactPrefix).toBe("results/t1/2025-01-15T10-30-00_run-001");
    });

    it("falls back to buildArtifactPrefix when resolveArtifactPrefix returns null", async () => {
      // resolveArtifactPrefix: exact miss, then search miss
      mockSend.mockResolvedValueOnce({ Contents: [] });
      mockSend.mockResolvedValueOnce({ CommonPrefixes: [] });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
        testType: "jmeter",
      });

      const info = await getArtifactInfo(api, "t1", "run-001");

      expect(info.artifactPrefix).toBe("results/t1/2025-01-15T10-30-00_run-001");
    });

    it("uses buildArtifactPrefix when scenariosBucket is not configured", async () => {
      const api = createMockApi(
        { testRunId: "run-001", startTime: "2025-01-15 10:30:00", testType: "k6" },
        { scenariosBucket: undefined, region: "us-east-1" }
      );

      const info = await getArtifactInfo(api, "t1", "run-001");

      expect(info.artifactPrefix).toBe("results/t1/2025-01-15T10-30-00_run-001");
      expect(mockSend).not.toHaveBeenCalled(); // No S3 calls
    });

    it("returns unable to determine when startTime is missing", async () => {
      const api = createMockApi({
        testRunId: "run-001",
        startTime: undefined,
        testType: "simple",
      });

      const info = await getArtifactInfo(api, "t1", "run-001");

      expect(info.artifactPrefix).toContain("unable to determine");
    });
  });

  describe("downloadRunArtifacts", () => {
    function createMockApi(runData: any, config?: any) {
      return {
        get: vi.fn().mockResolvedValue(runData),
        config: config ?? { scenariosBucket: "my-bucket", region: "us-east-1" },
        awsCredentialIdentity: fakeCreds,
      } as any;
    }

    it("throws when scenariosBucket is not configured", async () => {
      const api = createMockApi(
        {},
        { scenariosBucket: undefined, region: "us-east-1" }
      );

      await expect(downloadRunArtifacts(api, "t1", "run-001", {})).rejects.toThrow(
        "Scenarios bucket not configured"
      );
    });

    it("throws when test run has no startTime", async () => {
      const api = createMockApi({
        testRunId: "run-001",
        startTime: undefined,
      });

      await expect(downloadRunArtifacts(api, "t1", "run-001", {})).rejects.toThrow(
        "Test run has no startTime"
      );
    });

    it("returns early when no artifact folder found in S3", async () => {
      // resolveArtifactPrefix returns null
      mockSend.mockResolvedValueOnce({ Contents: [] });
      mockSend.mockResolvedValueOnce({ CommonPrefixes: [] });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", {});

      expect(consoleSpy).toHaveBeenCalledWith("No artifact folder found for this test run in S3.");
      consoleSpy.mockRestore();
    });

    it("returns early when no artifacts found after listing", async () => {
      // resolveArtifactPrefix: exact match found
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/x" }],
      });
      // listArtifacts: empty
      mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", {});

      expect(consoleSpy).toHaveBeenCalledWith("No artifacts found for this test run.");
      consoleSpy.mockRestore();
    });

    it("returns early when filter matches nothing", async () => {
      // resolveArtifactPrefix: exact match
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/x" }],
      });
      // listArtifacts: returns files
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/file.xml", Size: 100 }],
        IsTruncated: false,
      });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", { filter: "*.csv" });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No artifacts match the filter'));
      consoleSpy.mockRestore();
    });

    it("lists files in dry-run mode without downloading", async () => {
      // resolveArtifactPrefix: exact match
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/x" }],
      });
      // listArtifacts
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/2025-01-15T10-30-00_run-001/file1.xml", Size: 100 },
          { Key: "results/t1/2025-01-15T10-30-00_run-001/file2.json", Size: 200 },
        ],
        IsTruncated: false,
      });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", { dryRun: true });

      // Should log file names to stdout
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("file1.xml"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("file2.json"));
      // No download (GetObject) calls after the listing
      expect(mockSend).toHaveBeenCalledTimes(2); // only resolve + list
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("downloads to directory by default", async () => {
      const { Readable } = await import("node:stream");
      // resolveArtifactPrefix: exact match
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/x" }],
      });
      // listArtifacts
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/file.xml", Size: 50 }],
        IsTruncated: false,
      });
      // GetObject for download
      mockSend.mockResolvedValueOnce({ Body: Readable.from(["data"]) });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", { force: true });

      // 3 calls: resolve, list, getObject
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Done."));
      consoleSpy.mockRestore();
    });

    it("applies filter before downloading", async () => {
      const { Readable } = await import("node:stream");
      // resolveArtifactPrefix: exact match
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-30-00_run-001/x" }],
      });
      // listArtifacts
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/2025-01-15T10-30-00_run-001/file.xml", Size: 50 },
          { Key: "results/t1/2025-01-15T10-30-00_run-001/file.json", Size: 75 },
        ],
        IsTruncated: false,
      });
      // GetObject for download (only xml should be fetched)
      mockSend.mockResolvedValueOnce({ Body: Readable.from(["data"]) });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", { filter: "*.xml", force: true });

      // 3 calls: resolve, list, getObject (only 1 file matches filter)
      expect(mockSend).toHaveBeenCalledTimes(3);
      consoleSpy.mockRestore();
    });
  });
});
