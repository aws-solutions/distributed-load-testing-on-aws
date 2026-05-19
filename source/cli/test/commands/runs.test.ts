// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiConfig = {
  apiEndpoint: "https://api.example.com",
  userPoolId: "us-east-1_abc",
  userPoolClientId: "client",
  identityPoolId: "us-east-1:pool",
  userPoolDomain: "domain",
  region: "us-east-1",
  scenariosBucket: "my-bucket",
};
const mockApiAwsCredentialIdentity = {
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
  sessionToken: "TOKEN",
};

vi.mock("../../src/lib/api-client.js", () => ({
  ApiClient: {
    create: vi.fn(async () => ({
      get: mockApiGet,
      post: mockApiPost,
      config: mockApiConfig,
      region: mockApiConfig.region,
      awsCredentialIdentity: mockApiAwsCredentialIdentity,
      credentials: {
        authMode: "iam",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
      },
    })),
  },
}));

vi.mock("../../src/lib/output.js", () => ({
  printResult: vi.fn(),
  formatOption: vi.fn(() => {
    const { Option } = require("commander");
    return new Option("--format <format>", "Output format").default("table");
  }),
}));

vi.mock("../../src/lib/error-handler.js", () => ({
  withErrorHandler: (fn: Function) => fn,
}));

vi.mock("../../src/lib/run-formatters.js", () => ({
  formatTimestamp: vi.fn((ts: string) => ts),
  curateRunRow: vi.fn((r: Record<string, unknown>) => r),
  colorRunRow: vi.fn((r: Record<string, unknown>) => r),
  colorBaselineRow: vi.fn((r: Record<string, unknown>, _baselineRunId?: string) => r),
  isActive: vi.fn((s: string) => ["running", "pending", "provisioning"].includes(s?.toLowerCase())),
  extractBaselineMetrics: vi.fn(() => null),
  curateRunRowWithBaseline: vi.fn((r: Record<string, unknown>, _bm: unknown) => ({
    ...r,
    "Δ requests (3,811)": "+25.7%",
  })),
  enrichRunWithBaseline: vi.fn((r: Record<string, unknown>, _bm: unknown) => ({
    ...r,
    baseline: { baselineRunId: "base-1", requests: { baselineValue: 3811, delta: "+25.7%" } },
  })),
}));

vi.mock("../../src/lib/color.js", () => ({
  colorStatus: vi.fn((s: string) => s),
}));

const mockGetArtifactInfo = vi.fn();
const mockDownloadRunArtifacts = vi.fn();

vi.mock("../../src/lib/artifact-downloader.js", () => ({
  getArtifactInfo: (...args: unknown[]) => mockGetArtifactInfo(...args),
  downloadRunArtifacts: (...args: unknown[]) => mockDownloadRunArtifacts(...args),
}));

vi.mock("../../src/lib/prompt.js", () => ({
  confirmOverwrite: vi.fn(),
}));

import { registerRunsCommand } from "../../src/commands/runs.js";
import { printResult } from "../../src/lib/output.js";
import { extractBaselineMetrics, curateRunRowWithBaseline, enrichRunWithBaseline } from "../../src/lib/run-formatters.js";

describe("runs command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerRunsCommand(program);
    return program;
  }

  it("registers runs command with subcommands", () => {
    const program = createProgram();
    const runs = program.commands.find((c) => c.name() === "runs");
    expect(runs).toBeDefined();
    const subcmds = runs!.commands.map((c) => c.name());
    expect(subcmds).toContain("list");
    expect(subcmds).toContain("get");
    expect(subcmds).toContain("latest");
    expect(subcmds).toContain("baseline");
    expect(subcmds).toContain("artifacts");
    expect(subcmds).toContain("active");
    expect(subcmds).toContain("download");
  });

  describe("runs list", () => {
    it("lists test runs in table format", async () => {
      mockApiGet.mockResolvedValue({
        testRuns: [{ testRunId: "r1", status: "completed", startTime: "2024-01-01" }],
        pagination: {},
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1"]);

      expect(mockApiGet).toHaveBeenCalled();
      expect(printResult).toHaveBeenCalled();
    });

    it("lists test runs in JSON format", async () => {
      mockApiGet.mockResolvedValue({ testRuns: [], pagination: {} });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--format", "json"]);

      expect(printResult).toHaveBeenCalled();
    });

    it("paginates results", async () => {
      mockApiGet
        .mockResolvedValueOnce({
          testRuns: [{ testRunId: "r1", status: "completed" }],
          pagination: { next_token: "page2" },
        })
        .mockResolvedValueOnce({
          testRuns: [{ testRunId: "r2", status: "completed" }],
          pagination: {},
        });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1"]);

      expect(mockApiGet).toHaveBeenCalledTimes(2);
    });

    it("honours --limit option", async () => {
      mockApiGet.mockResolvedValue({
        testRuns: [
          { testRunId: "r1", status: "completed" },
          { testRunId: "r2", status: "completed" },
          { testRunId: "r3", status: "completed" },
        ],
        pagination: {},
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--limit", "2"]);

      expect(printResult).toHaveBeenCalled();
    });
  });

  describe("runs get", () => {
    it("gets a specific test run in table format", async () => {
      mockApiGet.mockResolvedValue({
        testRunId: "r1",
        status: "completed",
        startTime: "2024-01-01",
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "get", "t1", "r1"]);

      expect(mockApiGet).toHaveBeenCalledWith("/scenarios/t1/testruns/r1");
      expect(printResult).toHaveBeenCalled();
    });

    it("gets a specific test run in JSON format", async () => {
      mockApiGet.mockResolvedValue({
        testRunId: "r1",
        status: "completed",
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "get", "t1", "r1", "--format", "json"]);

      expect(printResult).toHaveBeenCalled();
    });
  });

  describe("runs latest", () => {
    it("gets the latest run", async () => {
      mockApiGet.mockResolvedValue({
        testRuns: [{ testRunId: "r1", status: "completed" }],
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "latest", "t1"]);

      expect(printResult).toHaveBeenCalled();
    });

    it("exits when no test runs found", async () => {
      mockApiGet.mockResolvedValue({ testRuns: [] });

      const program = createProgram();
      // The command calls process.exit(1) when no runs found
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });

      await expect(program.parseAsync(["node", "dlt", "runs", "latest", "t1"])).rejects.toThrow("exit");

      exitSpy.mockRestore();
    });
  });

  describe("runs list --baseline", () => {
    it("fetches baseline and uses curateRunRowWithBaseline for table format", async () => {
      // First call: test runs list, second call: baseline
      mockApiGet
        .mockResolvedValueOnce({
          testRuns: [{ testRunId: "r1", status: "completed", requests: 4792 }],
          pagination: {},
        })
        .mockResolvedValueOnce({
          testId: "t1",
          baselineId: "base-1",
          message: "ok",
          testRunDetails: {
            testRunId: "base-1",
            startTime: "2024-01-01",
            endTime: "2024-01-02",
            status: "complete",
            results: { total: { throughput: 3811, succ: 3811, fail: 0, avg_rt: "0.250", testDuration: "90" } },
          },
        });

      // Make extractBaselineMetrics return metrics
      vi.mocked(extractBaselineMetrics).mockReturnValueOnce({
        baselineRunId: "base-1",
        requests: 3811,
        success: 3811,
        errors: 0,
        avgResponseTime: 250,
        requestsPerSecond: 42.34,
        p50: 200,
        p90: 400,
        p99: 800,
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--baseline"]);

      // Should have fetched baseline
      expect(mockApiGet).toHaveBeenCalledTimes(2);
      expect(mockApiGet).toHaveBeenCalledWith("/scenarios/t1/baseline");
      expect(curateRunRowWithBaseline).toHaveBeenCalled();
      expect(printResult).toHaveBeenCalled();
    });

    it("fetches baseline and uses enrichRunWithBaseline for JSON format", async () => {
      mockApiGet
        .mockResolvedValueOnce({
          testRuns: [{ testRunId: "r1", status: "completed", requests: 4792 }],
          pagination: {},
        })
        .mockResolvedValueOnce({
          testId: "t1",
          baselineId: "base-1",
          message: "ok",
          testRunDetails: {
            testRunId: "base-1",
            results: { total: { throughput: 3811, succ: 3811, fail: 0, avg_rt: "0.250", testDuration: "90" } },
          },
        });

      vi.mocked(extractBaselineMetrics).mockReturnValueOnce({
        baselineRunId: "base-1",
        requests: 3811,
        success: 3811,
        errors: 0,
        avgResponseTime: 250,
        requestsPerSecond: 42.34,
        p50: 200,
        p90: 400,
        p99: 800,
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--baseline", "--format", "json"]);

      expect(enrichRunWithBaseline).toHaveBeenCalled();
      expect(printResult).toHaveBeenCalled();
    });

    it("falls back gracefully when no baseline is set", async () => {
      mockApiGet
        .mockResolvedValueOnce({
          testRuns: [{ testRunId: "r1", status: "completed" }],
          pagination: {},
        })
        .mockResolvedValueOnce({
          testId: "t1",
          baselineId: null,
          message: "No baseline set",
        });

      // extractBaselineMetrics returns null for no baseline
      vi.mocked(extractBaselineMetrics).mockReturnValueOnce(null);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--baseline"]);

      // Should still print results, just without baseline columns
      expect(curateRunRowWithBaseline).not.toHaveBeenCalled();
      expect(printResult).toHaveBeenCalled();
    });

    it("falls back gracefully when baseline API fails", async () => {
      mockApiGet
        .mockResolvedValueOnce({
          testRuns: [{ testRunId: "r1", status: "completed" }],
          pagination: {},
        })
        .mockRejectedValueOnce(new Error("API error"));

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--baseline"]);

      // Should still print results without baseline
      expect(curateRunRowWithBaseline).not.toHaveBeenCalled();
      expect(printResult).toHaveBeenCalled();
    });

    it("does not fetch baseline when --baseline flag is not used", async () => {
      mockApiGet.mockResolvedValue({
        testRuns: [{ testRunId: "r1", status: "completed" }],
        pagination: {},
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1"]);

      // Should only call API once (for test runs, not for baseline)
      expect(mockApiGet).toHaveBeenCalledTimes(1);
      expect(curateRunRowWithBaseline).not.toHaveBeenCalled();
    });
  });

  describe("runs baseline", () => {
    it("gets the baseline run", async () => {
      mockApiGet.mockResolvedValue({ testRunId: "r1", status: "completed" });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "baseline", "t1"]);

      expect(mockApiGet).toHaveBeenCalledWith("/scenarios/t1/baseline");
      expect(printResult).toHaveBeenCalled();
    });
  });

  describe("runs artifacts", () => {
    it("delegates to getArtifactInfo and prints result", async () => {
      mockGetArtifactInfo.mockResolvedValue({
        testId: "t1",
        runId: "r1",
        startTime: "2024-01-01T00:00:00Z",
        testType: "simple",
        artifactPrefix: "results/t1/prefix_r1",
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "artifacts", "t1", "r1"]);

      expect(mockGetArtifactInfo).toHaveBeenCalledWith(expect.anything(), "t1", "r1");
      expect(printResult).toHaveBeenCalled();
    });
  });

  describe("runs active", () => {
    it("shows active runs for a specific scenario", async () => {
      mockApiGet.mockResolvedValue({
        testId: "t1",
        testName: "Test 1",
        status: "running",
        startTime: "2024-01-01",
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "active", "t1"]);

      expect(printResult).toHaveBeenCalled();
    });

    it("shows active runs across all scenarios", async () => {
      mockApiGet.mockResolvedValue({
        Items: [
          { testId: "t1", testName: "Test 1", status: "running", startTime: "2024-01-01" },
          { testId: "t2", testName: "Test 2", status: "completed", startTime: "2024-01-01" },
        ],
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "active"]);

      expect(printResult).toHaveBeenCalled();
    });
  });

  describe("runs download", () => {
    it("delegates to downloadRunArtifacts with correct args", async () => {
      mockDownloadRunArtifacts.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1"]);

      expect(mockDownloadRunArtifacts).toHaveBeenCalledWith(
        expect.anything(), // api client
        "t1",
        "r1",
        expect.objectContaining({})
      );
    });

    it("passes --zip option through", async () => {
      mockDownloadRunArtifacts.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1", "--zip"]);

      expect(mockDownloadRunArtifacts).toHaveBeenCalledWith(
        expect.anything(),
        "t1",
        "r1",
        expect.objectContaining({ zip: true })
      );
    });

    it("passes --dry-run option through", async () => {
      mockDownloadRunArtifacts.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1", "--dry-run"]);

      expect(mockDownloadRunArtifacts).toHaveBeenCalledWith(
        expect.anything(),
        "t1",
        "r1",
        expect.objectContaining({ dryRun: true })
      );
    });

    it("passes --filter option through", async () => {
      mockDownloadRunArtifacts.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1", "--filter", "*.xml"]);

      expect(mockDownloadRunArtifacts).toHaveBeenCalledWith(
        expect.anything(),
        "t1",
        "r1",
        expect.objectContaining({ filter: "*.xml" })
      );
    });

    it("passes --output-dir option through", async () => {
      mockDownloadRunArtifacts.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1", "-o", "/tmp/out"]);

      expect(mockDownloadRunArtifacts).toHaveBeenCalledWith(
        expect.anything(),
        "t1",
        "r1",
        expect.objectContaining({ outputDir: "/tmp/out" })
      );
    });

    it("passes --force option through", async () => {
      mockDownloadRunArtifacts.mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1", "--force"]);

      expect(mockDownloadRunArtifacts).toHaveBeenCalledWith(
        expect.anything(),
        "t1",
        "r1",
        expect.objectContaining({ force: true })
      );
    });

    it("propagates errors from downloadRunArtifacts", async () => {
      mockDownloadRunArtifacts.mockRejectedValue(new Error("Scenarios bucket not configured"));

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1"])
      ).rejects.toThrow("Scenarios bucket not configured");
    });
  });
});
