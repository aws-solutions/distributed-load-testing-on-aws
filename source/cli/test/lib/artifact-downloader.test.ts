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
  // Identity realpath → resolved paths test as in-root; overridden per-test to simulate
  // a symlinked directory escaping the output root.
  realpathSync: vi.fn((p: string) => p),
  // Target absent / not a symlink by default; overridden per-test for the leaf case.
  lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
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
  stripControlChars,
  listArtifacts,
  resolveArtifactPrefix,
  collectRunArtifacts,
  createS3Client,
  downloadArtifactsToDir,
  downloadArtifactsToZip,
  getArtifactInfo,
  downloadRunArtifacts,
  type ArtifactFile,
} from "../../src/lib/artifact-downloader.js";
import { S3Client } from "@aws-sdk/client-s3";
import { createWriteStream, realpathSync, lstatSync } from "node:fs";

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

  describe("stripControlChars", () => {
    const CR = String.fromCharCode(13);
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);

    it("removes a carriage-return overwrite so the real name can't be disguised", () => {
      expect(stripControlChars("evil.sh" + CR + "          safe-results.txt")).toBe(
        "evil.sh          safe-results.txt"
      );
    });

    it("removes ANSI escape and OSC (terminal title) sequences", () => {
      expect(stripControlChars(ESC + "[31mDANGER" + ESC + "[0m" + ESC + "]0;pwned" + BEL + ".csv")).toBe(
        "[31mDANGER[0m]0;pwned.csv"
      );
    });

    it("removes C0 controls, DEL, and C1 controls", () => {
      expect(stripControlChars("a\tb\nc" + String.fromCharCode(0x7f) + String.fromCharCode(0x9f) + "d")).toBe("abcd");
    });

    it("leaves ordinary and non-ASCII characters untouched", () => {
      expect(stripControlChars("my data (1).csv")).toBe("my data (1).csv");
      expect(stripControlChars("résumé.csv")).toBe("résumé.csv");
      expect(stripControlChars("压测.csv")).toBe("压测.csv");
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
    it("returns the modern run folder even when its timestamp differs from startTime", async () => {
      const client = new S3Client({});
      // Folder timestamp (12-31-00) intentionally differs from startTime (12:30:45)
      // to prove resolution matches on the _{testRunId}/ marker, not the timestamp.
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2024-01-01T12-31-00_run-abc/us-east-1/file.xml", Size: 100 }],
        IsTruncated: false,
      });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: undefined },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBe("results/t1/2024-01-01T12-31-00_run-abc");
    });

    it("finds the run folder across pagination (>1000 objects)", async () => {
      const client = new S3Client({});
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: "results/t1/2024-01-01T00-00-00_run-other/f.xml", Size: 1 }],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: "results/t1/2024-01-01T12-31-00_run-abc/f.xml", Size: 2 }],
          IsTruncated: false,
        });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: undefined },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBe("results/t1/2024-01-01T12-31-00_run-abc");
    });

    it("returns the flat test prefix for legacy timestamped files", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2024-01-01T12:30:50.results.xml", Size: 100 }],
        IsTruncated: false,
      });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: undefined },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBe("results/t1/");
    });

    it("honours the run's endTime for a legacy run longer than the fallback window", async () => {
      const client = new S3Client({});
      // File is ~5 min after startTime — well beyond the 90s fallback window, but
      // within the run's real [startTime, endTime]. Passing endTime must find it.
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2024-01-01T12:35:00.results.xml", Size: 100 }],
        IsTruncated: false,
      });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: "2024-01-01 12:40:00" }, // real endTime
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBe("results/t1/");
    });

    it("returns null when neither a run folder nor legacy files match", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2024-01-01T00-00-00_run-other/f.xml", Size: 1 }],
        IsTruncated: false,
      });

      const result = await resolveArtifactPrefix(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: undefined },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(result).toBeNull();
    });
  });

  describe("collectRunArtifacts", () => {
    it("collects modern-layout files by the _{testRunId}/ marker", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/2024-01-01T12-31-00_run-abc/us-east-1/results.xml", Size: 100 },
          { Key: "results/t1/2024-01-01T12-31-00_run-abc/eu-west-1/results.xml", Size: 200 },
          // A different run's files under the same testId must be excluded.
          { Key: "results/t1/2024-01-01T00-00-00_run-other/us-east-1/results.xml", Size: 300 },
        ],
        IsTruncated: false,
      });

      const files = await collectRunArtifacts(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: "2024-01-01 12:32:00" },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.relativePath).sort()).toEqual([
        "eu-west-1/results.xml",
        "us-east-1/results.xml",
      ]);
    });

    it("paginates fully when a scenario has more than one page of objects", async () => {
      const client = new S3Client({});
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: "results/t1/2024-01-01T00-00-00_run-other/f.xml", Size: 1 }],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: "results/t1/2024-01-01T12-31-00_run-abc/f.xml", Size: 2 }],
          IsTruncated: false,
        });

      const files = await collectRunArtifacts(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: undefined },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(files).toHaveLength(1);
      expect(files[0]!.relativePath).toBe("f.xml");
    });

    it("falls back to legacy timestamp-window matching when no run folder exists", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/2024-01-01T12:30:50.results.xml", Size: 100 }, // inside window
          { Key: "results/t1/2024-01-01T12:40:00.results.xml", Size: 200 }, // outside window
          { Key: "results/t1/no-timestamp.txt", Size: 50 }, // no timestamp
        ],
        IsTruncated: false,
      });

      const files = await collectRunArtifacts(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: "2024-01-01 12:31:30" },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(files).toHaveLength(1);
      expect(files[0]!.relativePath).toBe("2024-01-01T12:30:50.results.xml");
    });

    it("returns an empty list when nothing matches", async () => {
      const client = new S3Client({});
      mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

      const files = await collectRunArtifacts(
        "my-bucket",
        "t1",
        { testRunId: "run-abc", startTime: "2024-01-01 12:30:45", endTime: undefined },
        "us-east-1",
        fakeCreds,
        client
      );

      expect(files).toHaveLength(0);
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
      const files: ArtifactFile[] = [{ key: "results/t1/run/file1.xml", relativePath: "file1.xml", size: 100 }];

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
      const files: ArtifactFile[] = [{ key: "results/t1/run/empty.xml", relativePath: "empty.xml", size: 0 }];

      mockSend.mockResolvedValueOnce({ Body: undefined });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: empty body"));
      consoleSpy.mockRestore();
    });

    it("rejects a traversal key without writing or fetching it", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/evil", relativePath: "../../../.ssh/authorized_keys", size: 100 },
      ];

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client);

      // A `..` segment is rejected outright — nothing fetched, nothing written.
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("no safe entry name"));
      expect(createWriteStream).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("skips a key whose leaf is empty (a traversal-only name)", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [{ key: "results/t1/run/dots", relativePath: "..", size: 100 }];

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("no safe entry name"));
      expect(createWriteStream).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("rejects a write whose directory resolves outside the output dir via a symlink", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/x", relativePath: "us-east-1/task/result.json", size: 100 },
      ];
      // realRoot (1st realpathSync call) stays in-root; the per-file dir canonicalizes outside it.
      vi.mocked(realpathSync).mockReturnValueOnce("/tmp/out").mockReturnValueOnce("/etc");

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("resolves outside the output directory via a symlink")
      );
      expect(createWriteStream).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("rejects a write whose target leaf is a symlink", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/x", relativePath: "us-east-1/task/result.json", size: 100 },
      ];
      // Directory is in-root (identity realpath), but the leaf itself is a symlink.
      vi.mocked(lstatSync).mockReturnValueOnce({ isSymbolicLink: () => true } as any);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("target is a symlink"));
      expect(createWriteStream).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("skips a single entry (without aborting the run) when its path cannot be resolved", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/x", relativePath: "us-east-1/task/result.json", size: 100 },
      ];
      // realRoot resolves; the per-file dir canonicalization throws (e.g. a dangling symlink).
      vi.mocked(realpathSync)
        .mockReturnValueOnce("/tmp/out")
        .mockImplementationOnce(() => {
          throw new Error("ENOENT");
        });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        downloadArtifactsToDir("my-bucket", files, "/tmp/out", "us-east-1", fakeCreds, client)
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("could not resolve a safe output path"));
      expect(createWriteStream).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("downloadArtifactsToZip", () => {
    it("downloads files into a zip archive", async () => {
      const { Readable } = await import("node:stream");
      const client = new S3Client({});
      const files: ArtifactFile[] = [{ key: "results/t1/run/file1.xml", relativePath: "file1.xml", size: 100 }];

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
      const files: ArtifactFile[] = [{ key: "results/t1/run/empty.xml", relativePath: "empty.xml", size: 0 }];

      mockSend.mockResolvedValueOnce({ Body: undefined });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToZip("my-bucket", files, "/tmp/out.zip", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: empty body"));
      consoleSpy.mockRestore();
    });

    it("rejects a traversal entry without archiving or fetching it", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [
        { key: "results/t1/run/evil", relativePath: "../../evil.sh", size: 100 },
      ];

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToZip("my-bucket", files, "/tmp/out.zip", "us-east-1", fakeCreds, client);

      // A `..` segment is rejected outright — the object is never fetched or archived.
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("no safe entry name"));
      expect(mockSend).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("skips an entry whose leaf is empty (a traversal-only name) without fetching it", async () => {
      const client = new S3Client({});
      const files: ArtifactFile[] = [{ key: "results/t1/run/dots", relativePath: "..", size: 100 }];

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadArtifactsToZip("my-bucket", files, "/tmp/out.zip", "us-east-1", fakeCreds, client);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("no safe entry name"));
      expect(mockSend).not.toHaveBeenCalled(); // no GetObject for skipped entry
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
      // Folder timestamp differs from startTime; resolution keys off the marker.
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-31-00_run-001/file.xml", Size: 10 }],
        IsTruncated: false,
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
      expect(info.artifactPrefix).toBe("results/t1/2025-01-15T10-31-00_run-001");
    });

    it("falls back to buildArtifactPrefix when resolveArtifactPrefix returns null", async () => {
      // No objects under results/t1/ → no modern folder, no legacy match → null.
      mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

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
      const api = createMockApi({}, { scenariosBucket: undefined, region: "us-east-1" });

      await expect(downloadRunArtifacts(api, "t1", "run-001", {})).rejects.toThrow("Scenarios bucket not configured");
    });

    it("throws when test run has no startTime", async () => {
      const api = createMockApi({
        testRunId: "run-001",
        startTime: undefined,
      });

      await expect(downloadRunArtifacts(api, "t1", "run-001", {})).rejects.toThrow("Test run has no startTime");
    });

    it("returns early when no artifacts found in S3", async () => {
      // collectRunArtifacts: listing under results/t1/ returns nothing.
      mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", {});

      expect(consoleSpy).toHaveBeenCalledWith("No artifacts found for this test run in S3.");
      consoleSpy.mockRestore();
    });

    it("returns early when filter matches nothing", async () => {
      // collectRunArtifacts: one modern file for the run.
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-31-00_run-001/file.xml", Size: 100 }],
        IsTruncated: false,
      });

      const api = createMockApi({
        testRunId: "run-001",
        startTime: "2025-01-15 10:30:00",
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", { filter: "*.csv" });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No artifacts match the filter"));
      consoleSpy.mockRestore();
    });

    it("lists files in dry-run mode without downloading", async () => {
      // collectRunArtifacts: single listing page with two modern files.
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/2025-01-15T10-31-00_run-001/file1.xml", Size: 100 },
          { Key: "results/t1/2025-01-15T10-31-00_run-001/file2.json", Size: 200 },
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
      // Only the listing call; no GetObject downloads in dry-run.
      expect(mockSend).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("previews skipped (unsafe) entries in dry-run without listing them as downloadable", async () => {
      // One safe file and one traversal key that the name gate rejects.
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/2025-01-15T10-31-00_run-001/good.xml", Size: 100 },
          { Key: "results/t1/2025-01-15T10-31-00_run-001/../../evil.sh", Size: 50 },
        ],
        IsTruncated: false,
      });

      const api = createMockApi({ testRunId: "run-001", startTime: "2025-01-15 10:30:00" });

      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await downloadRunArtifacts(api, "t1", "run-001", { dryRun: true });

      // Safe file listed to stdout; unsafe one flagged as a would-skip on stderr, not listed.
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("good.xml"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("evil.sh"));
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("would skip"));
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("no safe entry name"));
      expect(mockSend).toHaveBeenCalledTimes(1); // still no GetObject in dry-run
      errSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("downloads to directory by default", async () => {
      const { Readable } = await import("node:stream");
      // collectRunArtifacts: single listing page.
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "results/t1/2025-01-15T10-31-00_run-001/file.xml", Size: 50 }],
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

      // 2 calls: list + getObject
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Done."));
      consoleSpy.mockRestore();
    });

    it("applies filter before downloading", async () => {
      const { Readable } = await import("node:stream");
      // collectRunArtifacts: single listing page with two files.
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: "results/t1/2025-01-15T10-31-00_run-001/file.xml", Size: 50 },
          { Key: "results/t1/2025-01-15T10-31-00_run-001/file.json", Size: 75 },
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

      // 2 calls: list + getObject (only 1 file matches filter)
      expect(mockSend).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });
  });
});
