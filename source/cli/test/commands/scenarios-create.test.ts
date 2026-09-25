// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();
const mockApiPut = vi.fn();

vi.mock("../../src/lib/api-client.js", () => ({
  ApiClient: {
    create: vi.fn(async () => ({
      get: mockApiGet,
      post: mockApiPost,
      delete: mockApiDelete,
      put: mockApiPut,
      config: { scenariosBucket: "test-bucket", region: "us-east-1" },
      awsCredentialIdentity: {
        accessKeyId: "AKIA123",
        secretAccessKey: "secret",
        sessionToken: "token",
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

const mockUploadTestFile = vi.fn();
vi.mock("../../src/lib/file-uploader.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/file-uploader.js")>();
  return {
    uploadTestFile: (...args: unknown[]) => mockUploadTestFile(...args),
    // Keep the real extension validator so create file checks are exercised.
    assertScriptFileMatchesTestType: actual.assertScriptFileMatchesTestType,
    // Pure helper used by fileTypeFor/buildScenariosObject; keep the real one.
    fileExtension: actual.fileExtension,
  };
});

const mockStartScenario = vi.fn();
vi.mock("../../src/lib/scenario-launcher.js", () => ({
  startScenario: (...args: unknown[]) => mockStartScenario(...args),
}));

vi.mock("../../src/lib/run-formatters.js", () => ({
  isActive: vi.fn((s?: string) =>
    ["queued", "provisioning", "running", "cancelling", "cleaning up", "parsing results"].includes(
      (s ?? "").toLowerCase()
    )
  ),
  formatTimestamp: vi.fn((ts: string) => ts),
  curateRunRow: vi.fn((r: Record<string, unknown>) => r),
  colorRunRow: vi.fn((r: Record<string, unknown>) => r),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/color.js", () => ({
  colorStatus: vi.fn((s: string) => s),
}));

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerScenariosCommand } from "../../src/commands/scenarios.js";
import { printResult } from "../../src/lib/output.js";

function writeSpec(spec: Record<string, unknown>): string {
  const path = join(mkdtempSync(join(tmpdir(), "dlt-create-spec-")), "spec.json");
  writeFileSync(path, JSON.stringify(spec), "utf-8");
  return path;
}

describe("scenarios create command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("registers the create subcommand", () => {
    const program = createProgram();
    const scenarios = program.commands.find((c) => c.name() === "scenarios");
    expect(scenarios).toBeDefined();
    const subcmds = scenarios!.commands.map((c) => c.name());
    expect(subcmds).toContain("create");
  });

  describe("simple test creation", () => {
    it("creates a simple test scenario", async () => {
      mockApiPost.mockResolvedValue({ testId: "new-test-123" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "My Test",
        "--test-description",
        "A load test",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com/api",
        "--concurrency",
        "10",
        "--task-count",
        "2",
        "--regions",
        "us-east-1",
        "--hold-for",
        "5m",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testName: "My Test",
          testDescription: "A load test",
          testType: "simple",
          fileType: "none",
          testTaskConfigs: [{ region: "us-east-1", concurrency: 10, taskCount: 2 }],
          testScenario: {
            execution: [
              {
                concurrency: 10,
                "ramp-up": "0s",
                "hold-for": "5m",
                scenario: "My Test",
              },
            ],
            scenarios: {
              "My Test": {
                requests: [{ url: "https://example.com/api", method: "GET", headers: {} }],
              },
            },
          },
        })
      );
      expect(printResult).toHaveBeenCalledWith({ testId: "new-test-123" }, { format: "table" });
    });

    it("trims surrounding whitespace from the name across the whole payload", async () => {
      mockApiPost.mockResolvedValue({ testId: "trim-test-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "  Padded Name  ",
        "--test-description",
        "A load test",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com/api",
        "--concurrency",
        "10",
        "--task-count",
        "2",
        "--regions",
        "us-east-1",
        "--hold-for",
        "5m",
      ]);

      // The trimmed name must reach the top-level field, the scenarios map key, and execution.scenario.
      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testName: "Padded Name",
          testScenario: expect.objectContaining({
            execution: [expect.objectContaining({ scenario: "Padded Name" })],
            scenarios: { "Padded Name": expect.anything() },
          }),
        })
      );
    });

    it("creates a simple test with custom HTTP method and body", async () => {
      mockApiPost.mockResolvedValue({ testId: "post-test-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "POST Test",
        "--test-description",
        "POST test",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com/api",
        "--http-method",
        "POST",
        "--body",
        '{"key":"value"}',
        "--headers",
        '{"Content-Type":"application/json"}',
        "--concurrency",
        "5",
        "--task-count",
        "1",
        "--regions",
        "us-east-1",
        "--hold-for",
        "10m",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testScenario: expect.objectContaining({
            scenarios: {
              "POST Test": {
                requests: [
                  {
                    url: "https://example.com/api",
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: '{"key":"value"}',
                  },
                ],
              },
            },
          }),
        })
      );
    });

    it("applies same concurrency and tasks to each region", async () => {
      mockApiPost.mockResolvedValue({ testId: "multi-region-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "Multi Region",
        "--test-description",
        "Multi region test",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com",
        "--concurrency",
        "10",
        "--task-count",
        "4",
        "--regions",
        "us-east-1,eu-west-1",
        "--hold-for",
        "5m",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testTaskConfigs: [
            { region: "us-east-1", concurrency: 10, taskCount: 4 },
            { region: "eu-west-1", concurrency: 10, taskCount: 4 },
          ],
        })
      );
    });
  });

  describe("script test with file upload", () => {
    it("uploads a JMeter script file", async () => {
      mockUploadTestFile.mockResolvedValue({
        key: "test-scenarios/jmeter/abc123/test.jmx",
        fileType: "script",
      });
      mockApiPost.mockResolvedValue({ testId: "jmeter-test-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "JMeter Test",
        "--test-description",
        "Script test",
        "--test-type",
        "jmeter",
        "--file",
        "./test.jmx",
        "--concurrency",
        "5",
        "--task-count",
        "1",
        "--regions",
        "us-east-1",
        "--hold-for",
        "10m",
      ]);

      expect(mockUploadTestFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filePath: "./test.jmx",
          testType: "jmeter",
        })
      );
      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          fileType: "script",
          testScenario: {
            execution: [
              expect.objectContaining({
                scenario: "JMeter Test",
                executor: "jmeter",
              }),
            ],
            scenarios: {
              "JMeter Test": expect.objectContaining({
                script: expect.stringMatching(/\.jmx$/),
              }),
            },
          },
        })
      );
    });

    it("uploads a zip file and sets fileType to zip", async () => {
      mockUploadTestFile.mockResolvedValue({
        key: "test-scenarios/k6/abc456/scripts.zip",
        fileType: "zip",
      });
      mockApiPost.mockResolvedValue({ testId: "k6-test-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "K6 Test",
        "--test-description",
        "K6 zip test",
        "--test-type",
        "k6",
        "--file",
        "./scripts.zip",
        "--concurrency",
        "3",
        "--task-count",
        "1",
        "--regions",
        "eu-west-1",
        "--hold-for",
        "5m",
      ]);

      expect(mockUploadTestFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filePath: "./scripts.zip",
          testType: "k6",
        })
      );
      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          fileType: "zip",
        })
      );
    });
  });

  describe("scheduled test", () => {
    it("creates a scheduled test with cron expression", async () => {
      mockApiPost.mockResolvedValue({ testId: "sched-test-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "Nightly Test",
        "--test-description",
        "Nightly run",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com",
        "--concurrency",
        "10",
        "--task-count",
        "2",
        "--regions",
        "us-east-1",
        "--hold-for",
        "5m",
        "--cron",
        "0 8 * * *",
        "--schedule-timezone",
        "US/Pacific",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          scheduleStep: "create",
          cronValue: "0 8 * * *",
          scheduleTimezone: "US/Pacific",
        })
      );
    });

    it("creates a scheduled test with expiry date", async () => {
      mockApiPost.mockResolvedValue({ testId: "sched-test-2" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "Expiry Test",
        "--test-description",
        "Test with expiry",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com",
        "--concurrency",
        "5",
        "--task-count",
        "1",
        "--regions",
        "us-east-1",
        "--hold-for",
        "3m",
        "--cron",
        "0 9 * * *",
        "--cron-expiry-date",
        "2025-12-31",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          cronValue: "0 9 * * *",
          cronExpiryDate: "2025-12-31",
        })
      );
    });
  });

  describe("save-only flag", () => {
    it("creates a test with save-only flag", async () => {
      mockApiPost.mockResolvedValue({ testId: "save-only-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "Save Only Test",
        "--test-description",
        "Saved test",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com",
        "--concurrency",
        "5",
        "--task-count",
        "1",
        "--regions",
        "us-east-1",
        "--hold-for",
        "5m",
        "--save-only",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          saveOnly: true,
        })
      );
    });
  });

  describe("missing required parameters", () => {
    it("throws error when --test-name is missing", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "dlt",
          "scenarios",
          "create",
          "--test-description",
          "Desc",
          "--test-type",
          "simple",
          "--concurrency",
          "5",
          "--task-count",
          "1",
          "--regions",
          "us-east-1",
          "--hold-for",
          "5m",
        ])
      ).rejects.toThrow();
    });

    it("throws error when --test-type is missing", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "dlt",
          "scenarios",
          "create",
          "--test-name",
          "Test",
          "--test-description",
          "Desc",
          "--concurrency",
          "5",
          "--task-count",
          "1",
          "--regions",
          "us-east-1",
          "--hold-for",
          "5m",
        ])
      ).rejects.toThrow();
    });

    it("throws error when --hold-for is missing", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "dlt",
          "scenarios",
          "create",
          "--test-name",
          "Test",
          "--test-description",
          "Desc",
          "--test-type",
          "simple",
          "--concurrency",
          "5",
          "--task-count",
          "1",
          "--regions",
          "us-east-1",
        ])
      ).rejects.toThrow();
    });

    it("throws error when --concurrency is missing", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "dlt",
          "scenarios",
          "create",
          "--test-name",
          "Test",
          "--test-description",
          "Desc",
          "--test-type",
          "simple",
          "--task-count",
          "1",
          "--regions",
          "us-east-1",
          "--hold-for",
          "5m",
        ])
      ).rejects.toThrow();
    });

    it("throws error when --regions is missing", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "dlt",
          "scenarios",
          "create",
          "--test-name",
          "Test",
          "--test-description",
          "Desc",
          "--test-type",
          "simple",
          "--concurrency",
          "5",
          "--task-count",
          "1",
          "--hold-for",
          "5m",
        ])
      ).rejects.toThrow();
    });
  });

  describe("API errors", () => {
    it("throws when API returns an error", async () => {
      mockApiPost.mockRejectedValue(new Error("API returned HTTP 400: Validation failed"));

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "dlt",
          "scenarios",
          "create",
          "--test-name",
          "Test",
          "--test-description",
          "Desc",
          "--test-type",
          "simple",
          "--http-endpoint",
          "https://example.com",
          "--concurrency",
          "5",
          "--task-count",
          "1",
          "--regions",
          "us-east-1",
          "--hold-for",
          "5m",
        ])
      ).rejects.toThrow("API returned HTTP 400");
    });

    it("throws when file upload fails", async () => {
      mockUploadTestFile.mockRejectedValue(new Error("File exceeds 50MB limit"));

      const program = createProgram();
      await expect(
        program.parseAsync([
          "node",
          "dlt",
          "scenarios",
          "create",
          "--test-name",
          "Test",
          "--test-description",
          "Desc",
          "--test-type",
          "jmeter",
          "--file",
          "./large-file.jmx",
          "--concurrency",
          "5",
          "--task-count",
          "1",
          "--regions",
          "us-east-1",
          "--hold-for",
          "5m",
        ])
      ).rejects.toThrow("File exceeds 50MB limit");
    });
  });

  describe("output format", () => {
    it("outputs in JSON format when specified", async () => {
      mockApiPost.mockResolvedValue({ testId: "json-test-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "JSON Test",
        "--test-description",
        "JSON test",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com",
        "--concurrency",
        "5",
        "--task-count",
        "1",
        "--regions",
        "us-east-1",
        "--hold-for",
        "5m",
        "--format",
        "json",
      ]);

      expect(printResult).toHaveBeenCalledWith({ testId: "json-test-1" }, { format: "json" });
    });
  });

  describe("ramp-up option", () => {
    it("includes custom ramp-up in the payload", async () => {
      mockApiPost.mockResolvedValue({ testId: "rampup-test-1" });

      const program = createProgram();
      await program.parseAsync([
        "node",
        "dlt",
        "scenarios",
        "create",
        "--test-name",
        "Ramp Test",
        "--test-description",
        "Ramp test",
        "--test-type",
        "simple",
        "--http-endpoint",
        "https://example.com",
        "--concurrency",
        "10",
        "--task-count",
        "2",
        "--regions",
        "us-east-1",
        "--hold-for",
        "5m",
        "--ramp-up",
        "2m",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testScenario: expect.objectContaining({
            execution: [
              expect.objectContaining({
                "ramp-up": "2m",
              }),
            ],
          }),
        })
      );
    });
  });

  describe("outbound request validation", () => {
    it("rejects an invalid payload with a client-side error naming the offending field", async () => {
      // --test-name "ab" passes Commander (present) but is too short for the
      // shared createTestSchema (min 3 chars), so validation should fail
      // locally before any request is sent.
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "ab", "--test-description", "Valid description",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--concurrency", "5", "--task-count", "1", "--regions", "us-east-1", "--hold-for", "5m",
        ])
      ).rejects.toThrow(/testName/);

      // The malformed payload must never reach the API client.
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it("names the offending field for an invalid region", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Valid Name", "--test-description", "Valid description",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--concurrency", "5", "--task-count", "1", "--regions", "not_a_region", "--hold-for", "5m",
        ])
      ).rejects.toThrow(/region/);
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe("native run mode", () => {
    it("creates a native-mode locust test with only the safety timeout", async () => {
      mockUploadTestFile.mockResolvedValue({ key: "test-scenarios/locust/abc/locustfile.py", fileType: "script" });
      mockApiPost.mockResolvedValue({ testId: "locust-native-1" });

      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create",
        "--test-name", "Locust Native", "--test-description", "Native run",
        "--test-type", "locust", "--file", "./locustfile.py",
        "--task-count", "2", "--regions", "us-east-1",
        "--native-mode", "--max-test-duration", "30m",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testType: "locust",
          // Native runs are duration-driven; concurrency is a placeholder of 1.
          testTaskConfigs: [{ region: "us-east-1", concurrency: 1, taskCount: 2 }],
          nativeRunMode: { maxTestDurationSeconds: 1800 },
        })
      );
    });

    it("sends placeholder execution timings in native mode", async () => {
      mockUploadTestFile.mockResolvedValue({ key: "k", fileType: "script" });
      mockApiPost.mockResolvedValue({ testId: "k6-native-1" });

      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create",
        "--test-name", "k6 Native", "--test-description", "Native run",
        "--test-type", "k6", "--file", "./script.js",
        "--task-count", "1", "--regions", "us-east-1",
        "--native-mode", "--max-test-duration", "1h",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testScenario: expect.objectContaining({
            execution: [expect.objectContaining({ "ramp-up": "0s", "hold-for": "1s", executor: "k6" })],
          }),
          nativeRunMode: { maxTestDurationSeconds: 3600 },
        })
      );
    });

    it("does not require --concurrency or --hold-for in native mode", async () => {
      mockUploadTestFile.mockResolvedValue({ key: "j", fileType: "script" });
      mockApiPost.mockResolvedValue({ testId: "jmeter-native-1" });

      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create",
        "--test-name", "JMeter Native", "--test-description", "Native run",
        "--test-type", "jmeter", "--file", "./test.jmx",
        "--task-count", "1", "--regions", "us-east-1",
        "--native-mode", "--max-test-duration", "20m",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({ nativeRunMode: { maxTestDurationSeconds: 1200 } })
      );
    });

    it("rejects --native-mode for a simple test", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Bad Native", "--test-description", "Native run",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--task-count", "1", "--regions", "us-east-1",
          "--native-mode", "--max-test-duration", "20m",
        ])
      ).rejects.toThrow(/only supported for jmeter, k6, and locust/);
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it("rejects --native-mode without --max-test-duration", async () => {
      mockUploadTestFile.mockResolvedValue({ key: "j", fileType: "script" });
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "No Duration", "--test-description", "Native run",
          "--test-type", "locust", "--file", "./locustfile.py",
          "--task-count", "1", "--regions", "us-east-1",
          "--native-mode",
        ])
      ).rejects.toThrow(/--max-test-duration is required/);
      expect(mockApiPost).not.toHaveBeenCalled();
    });

  });

  describe("tags and healthy threshold", () => {
    it("passes parsed --tags and --healthy-threshold in the payload", async () => {
      mockApiPost.mockResolvedValue({ testId: "t-1" });
      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create",
        "--test-name", "Tagged", "--test-description", "desc",
        "--test-type", "simple", "--http-endpoint", "https://example.com",
        "--concurrency", "5", "--task-count", "1", "--regions", "us-east-1", "--hold-for", "5m",
        "--tags", "perf, regression ,smoke", "--healthy-threshold", "75",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({ tags: ["perf", "regression", "smoke"], healthyThreshold: 75 })
      );
    });

    it("defaults to empty tags and healthyThreshold 90", async () => {
      mockApiPost.mockResolvedValue({ testId: "t-2" });
      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create",
        "--test-name", "Defaults", "--test-description", "desc",
        "--test-type", "simple", "--http-endpoint", "https://example.com",
        "--concurrency", "5", "--task-count", "1", "--regions", "us-east-1", "--hold-for", "5m",
      ]);
      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({ tags: [], healthyThreshold: 90 })
      );
    });

    it("rejects a healthy threshold above 100", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Bad", "--test-description", "desc",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--concurrency", "5", "--task-count", "1", "--regions", "us-east-1", "--hold-for", "5m",
          "--healthy-threshold", "150",
        ])
      ).rejects.toThrow("--healthy-threshold must be an integer between 0 and 100");
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe("file extension validation", () => {
    it("rejects a script whose extension does not match the framework", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Mismatch", "--test-description", "desc",
          "--test-type", "k6", "--file", "./locustfile.py",
          "--concurrency", "5", "--task-count", "1", "--regions", "us-east-1", "--hold-for", "5m",
        ])
      ).rejects.toThrow(/--file for a k6 test/);
      expect(mockUploadTestFile).not.toHaveBeenCalled();
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it("rejects a native duration over 24h", async () => {
      mockUploadTestFile.mockResolvedValue({ key: "k", fileType: "script" });
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "TooLong", "--test-description", "desc",
          "--test-type", "locust", "--file", "./locustfile.py",
          "--task-count", "1", "--regions", "us-east-1",
          "--native-mode", "--max-test-duration", "48h",
        ])
      ).rejects.toThrow(/--max-test-duration must not exceed 24h/);
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe("--from-file", () => {
    it("creates a scenario entirely from a spec file", async () => {
      mockApiPost.mockResolvedValue({ testId: "ff-1" });
      const specPath = writeSpec({
        testName: "From Spec",
        testDescription: "spec-defined",
        testType: "simple",
        httpEndpoint: "https://example.com",
        concurrency: 10,
        taskCount: 2,
        regions: ["us-east-1", "eu-west-1"],
        holdFor: "5m",
        tags: ["spec", "smoke"],
        healthyThreshold: 80,
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "create", "--from-file", specPath]);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/scenarios",
        expect.objectContaining({
          testName: "From Spec",
          testType: "simple",
          testTaskConfigs: [
            { region: "us-east-1", concurrency: 10, taskCount: 2 },
            { region: "eu-west-1", concurrency: 10, taskCount: 2 },
          ],
          tags: ["spec", "smoke"],
          healthyThreshold: 80,
        })
      );
    });

    it("lets a command-line flag override the spec file", async () => {
      mockApiPost.mockResolvedValue({ testId: "ff-2" });
      const specPath = writeSpec({
        testName: "Spec Name",
        testDescription: "spec-defined",
        testType: "simple",
        httpEndpoint: "https://example.com",
        concurrency: 10,
        taskCount: 1,
        regions: "us-east-1",
        holdFor: "5m",
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create", "--from-file", specPath, "--test-name", "Flag Name",
      ]);

      expect(mockApiPost).toHaveBeenCalledWith("/scenarios", expect.objectContaining({ testName: "Flag Name" }));
    });

    it("rejects a spec file with an unknown field", async () => {
      const specPath = writeSpec({ testName: "X", bogusField: true });
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "dlt", "scenarios", "create", "--from-file", specPath])
      ).rejects.toThrow(/Unknown field\(s\) in spec file: bogusField/);
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it("still enforces required fields when the spec omits them", async () => {
      const specPath = writeSpec({ testName: "Only Name" });
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "dlt", "scenarios", "create", "--from-file", specPath])
      ).rejects.toThrow(/--test-description is required/);
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe("--dry-run", () => {
    it("prints the payload and does not upload or POST", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create",
        "--test-name", "Dry Run JMeter", "--test-description", "preview only",
        "--test-type", "jmeter", "--file", "./test.jmx",
        "--concurrency", "5", "--task-count", "1", "--regions", "us-east-1",
        "--hold-for", "5m", "--dry-run", "--format", "json",
      ]);

      // No side effects: no file upload, no create request.
      expect(mockUploadTestFile).not.toHaveBeenCalled();
      expect(mockApiPost).not.toHaveBeenCalled();

      // The assembled body is printed, with fileType derived from the extension.
      expect(printResult).toHaveBeenCalledWith(
        expect.objectContaining({
          testType: "jmeter",
          fileType: "script",
          testScenario: expect.objectContaining({
            scenarios: { "Dry Run JMeter": expect.objectContaining({ script: expect.stringMatching(/\.jmx$/) }) },
          }),
        }),
        { format: "json" }
      );
    });

    it("previews a native-mode body without side effects", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "dlt", "scenarios", "create",
        "--test-name", "Dry Run Native", "--test-description", "preview only",
        "--test-type", "locust", "--file", "./locustfile.py",
        "--task-count", "1", "--regions", "us-east-1",
        "--native-mode", "--max-test-duration", "10m",
        "--dry-run", "--format", "json",
      ]);

      expect(mockUploadTestFile).not.toHaveBeenCalled();
      expect(mockApiPost).not.toHaveBeenCalled();
      expect(printResult).toHaveBeenCalledWith(
        expect.objectContaining({
          nativeRunMode: { maxTestDurationSeconds: 600 },
        }),
        { format: "json" }
      );
    });
  });

  describe("validation edge cases", () => {
    it("throws when concurrency is not a positive integer", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Test", "--test-description", "Desc",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--concurrency", "0", "--task-count", "1", "--regions", "us-east-1", "--hold-for", "5m",
        ])
      ).rejects.toThrow("--concurrency must be a positive integer");
    });

    it("throws when task-count is not a positive integer", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Test", "--test-description", "Desc",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--concurrency", "1", "--task-count", "3.5", "--regions", "us-east-1", "--hold-for", "5m",
        ])
      ).rejects.toThrow("--task-count must be a positive integer");
    });

    it("throws when regions is empty after parsing", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Test", "--test-description", "Desc",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--concurrency", "1", "--task-count", "1", "--regions", " , , ", "--hold-for", "5m",
        ])
      ).rejects.toThrow("--regions must contain at least one valid region");
    });

    it("throws when headers is not valid JSON", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          "node", "dlt", "scenarios", "create",
          "--test-name", "Test", "--test-description", "Desc",
          "--test-type", "simple", "--http-endpoint", "https://example.com",
          "--concurrency", "1", "--task-count", "1", "--regions", "us-east-1", "--hold-for", "5m",
          "--headers", "not-json",
        ])
      ).rejects.toThrow("--headers must be valid JSON");
    });
  });
});
