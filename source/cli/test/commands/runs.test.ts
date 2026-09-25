// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { MAX_TEST_RUNS_PER_DELETE_REQUEST } from "@amzn/dlt-common";

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();
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
      put: mockApiPut,
      delete: mockApiDelete,
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

// results-formatter is used real here: runs get/latest route through its
// fetchLatestRun + renderRun, and renderRun calls the mocked printResult, so
// the printResult assertions and the CSV rendering still work end to end.

vi.mock("../../src/lib/color.js", () => ({
  colorStatus: vi.fn((s: string) => s),
  colorErrors: vi.fn((v: unknown) => v),
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
import {
  extractBaselineMetrics,
  curateRunRowWithBaseline,
  enrichRunWithBaseline,
} from "../../src/lib/run-formatters.js";

/**
 * Render the data from the most recent printResult(...) call using the REAL
 * formatCsv implementation. printResult is mocked in this suite, so this lets
 * the CSV tests assert on actual RFC-4180 output (header row + data) rather
 * than just the format argument.
 */
async function renderLastCsv(): Promise<string> {
  const actual = await vi.importActual<typeof import("../../src/lib/output.js")>("../../src/lib/output.js");
  const lastCall = vi.mocked(printResult).mock.calls.at(-1);
  const data = lastCall?.[0];
  const rows = Array.isArray(data) ? data : [data];
  return actual.formatCsv(rows as Record<string, unknown>[]);
}

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

    it("rejects a non-numeric --limit before making any request", async () => {
      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "runs", "list", "t1", "--limit", "abc"])).rejects.toThrow(
        "--limit must be a positive integer"
      );
      expect(mockApiGet).not.toHaveBeenCalled();
    });

    it("rejects a zero --limit", async () => {
      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "runs", "list", "t1", "--limit", "0"])).rejects.toThrow(
        "--limit must be a positive integer"
      );
      expect(mockApiGet).not.toHaveBeenCalled();
    });

    it("lists test runs in CSV format with a header row", async () => {
      mockApiGet.mockResolvedValue({
        testRuns: [{ testRunId: "r1", status: "completed", startTime: "2024-01-01" }],
        pagination: {},
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--format", "csv"]);

      // Routes to the csv branch (previously fell through to json)
      expect(printResult).toHaveBeenCalledWith(expect.any(Array), { format: "csv" });

      // The curated rows render as RFC-4180 CSV with a header row + data
      const csv = await renderLastCsv();
      const lines = csv.split("\n");
      expect(lines[0]).toContain("testRunId");
      expect(lines[0]).toContain("status");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("r1");
    });

    it("honors start timestamp filter", async () => {
      mockApiGet.mockResolvedValue({
        testRuns: [{ testRunId: "r1", status: "completed", startTime: "2024-01-01" }],
        pagination: {},
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--start-timestamp", "2024-01-01T00:00:00Z"]);

      expect(mockApiGet).toHaveBeenCalledWith("/scenarios/t1/testruns?start_timestamp=2024-01-01T00%3A00%3A00Z&limit=100");
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

    it("gets a specific test run in CSV format with a header row", async () => {
      mockApiGet.mockResolvedValue({
        testRunId: "r1",
        status: "completed",
        startTime: "2024-01-01",
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "get", "t1", "r1", "--format", "csv"]);

      expect(printResult).toHaveBeenCalledWith(expect.any(Object), { format: "csv" });

      const csv = await renderLastCsv();
      const lines = csv.split("\n");
      expect(lines[0]).toContain("testRunId");
      expect(lines[0]).toContain("status");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("r1");
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

    it("throws a descriptive error (handled by withErrorHandler) when no test runs found", async () => {
      mockApiGet.mockResolvedValue({ testRuns: [] });

      const program = createProgram();
      // The handler now throws an Error (surfaced by withErrorHandler as
      // "Error: ..." with a non-zero exit) instead of calling process.exit(1)
      // directly, matching how every other handler reports failures.
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);

      await expect(program.parseAsync(["node", "dlt", "runs", "latest", "t1"])).rejects.toThrow(
        "No test runs found for this scenario."
      );

      // The handler must not exit the process directly; withErrorHandler owns
      // formatting and setting the exit code.
      expect(exitSpy).not.toHaveBeenCalled();

      exitSpy.mockRestore();
    });

    it("surfaces an 'Error: ...' message and exits non-zero via the real withErrorHandler", async () => {
      // Verify the end-to-end behavior other commands rely on: the thrown
      // Error is formatted with the "Error: " prefix and produces a non-zero
      // exit code. Uses the REAL withErrorHandler (the suite mocks it to a
      // pass-through for command registration tests above).
      const { withErrorHandler } = await vi.importActual<typeof import("../../src/lib/error-handler.js")>(
        "../../src/lib/error-handler.js"
      );

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);

      const wrapped = withErrorHandler(async () => {
        throw new Error("No test runs found for this scenario.");
      });

      await expect(wrapped()).rejects.toThrow("exit");
      expect(errorSpy).toHaveBeenCalledWith("Error: No test runs found for this scenario.");
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("gets the latest run in CSV format with a header row", async () => {
      mockApiGet.mockResolvedValue({
        testRuns: [{ testRunId: "r1", status: "completed", startTime: "2024-01-01" }],
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "latest", "t1", "--format", "csv"]);

      expect(printResult).toHaveBeenCalledWith(expect.any(Object), { format: "csv" });

      const csv = await renderLastCsv();
      const lines = csv.split("\n");
      expect(lines[0]).toContain("testRunId");
      expect(lines[0]).toContain("status");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("r1");
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

    it("fetches baseline and uses curateRunRowWithBaseline for CSV format", async () => {
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
      await program.parseAsync(["node", "dlt", "runs", "list", "t1", "--baseline", "--format", "csv"]);

      expect(curateRunRowWithBaseline).toHaveBeenCalled();
      expect(printResult).toHaveBeenCalledWith(expect.anything(), { format: "csv" });
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

  describe("runs baseline get", () => {
    it("gets the baseline run", async () => {
      mockApiGet.mockResolvedValue({ testRunId: "r1", status: "completed" });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "baseline", "get", "t1"]);

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
      await expect(program.parseAsync(["node", "dlt", "runs", "download", "t1", "r1"])).rejects.toThrow(
        "Scenarios bucket not configured"
      );
    });
  });

  describe("outbound request validation", () => {
    it("baseline set: valid run id passes through to the API client", async () => {
      mockApiPut.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "baseline", "set", "t1", "--run-id", "run-456"]);

      expect(mockApiPut).toHaveBeenCalledWith("/scenarios/t1/baseline", { testRunId: "run-456" });
    });

    it("baseline set: invalid run id fails locally with a field-level error", async () => {
      // A space is not allowed by the shared setBaselineSchema (testRunId regex),
      // so validation must reject it before any request is sent.
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "dlt", "runs", "baseline", "set", "t1", "--run-id", "bad id"])
      ).rejects.toThrow(/testRunId/);
      expect(mockApiPut).not.toHaveBeenCalled();
    });

    it("delete: valid run ids pass through to the API client", async () => {
      mockApiDelete.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "delete", "t1", "--run-id", "run-1", "--run-id", "run-2"]);

      expect(mockApiDelete).toHaveBeenCalledWith("/scenarios/t1/testruns", ["run-1", "run-2"]);
    });

    it("delete: the maximum number of run ids pass through in one request", async () => {
      mockApiDelete.mockResolvedValue({});
      const runIds = Array.from({ length: MAX_TEST_RUNS_PER_DELETE_REQUEST }, (_, index) => `run-${index}`);
      const args = runIds.flatMap((runId) => ["--run-id", runId]);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "runs", "delete", "t1", ...args]);

      expect(mockApiDelete).toHaveBeenCalledWith("/scenarios/t1/testruns", runIds);
    });

    it("delete: more than the maximum number of run ids fails locally", async () => {
      const runIds = Array.from({ length: MAX_TEST_RUNS_PER_DELETE_REQUEST + 1 }, (_, index) => `run-${index}`);
      const args = runIds.flatMap((runId) => ["--run-id", runId]);

      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "runs", "delete", "t1", ...args])).rejects.toThrow(
        `A maximum of ${MAX_TEST_RUNS_PER_DELETE_REQUEST} testRunIds is allowed per request`
      );
      expect(mockApiDelete).not.toHaveBeenCalled();
    });

    it("delete: an invalid run id fails locally with a field-level error", async () => {
      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "runs", "delete", "t1", "--run-id", "bad id"])).rejects.toThrow(
        /alphanumeric|testRunId/
      );
      expect(mockApiDelete).not.toHaveBeenCalled();
    });
  });
});
