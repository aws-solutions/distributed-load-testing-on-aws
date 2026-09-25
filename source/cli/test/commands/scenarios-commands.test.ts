// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

function writeSpec(spec: Record<string, unknown>): string {
  const path = join(mkdtempSync(join(tmpdir(), "dlt-update-spec-")), "spec.json");
  writeFileSync(path, JSON.stringify(spec), "utf-8");
  return path;
}

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
  colorErrors: vi.fn((v: unknown) => v),
}));

const mockUploadTestFile = vi.fn();
const mockCopyScriptObject = vi.fn();
// The copy handler calls the composed copyScenarioScript helper (which builds
// the S3 keys and performs the copy internally); mock it here and return a
// realistic new script filename so the handler's repoint is exercised.
const mockCopyScenarioScript = vi.fn(
  async (
    _api: unknown,
    p: { testType: string; fromTestId: string; toTestId: string; scriptFileName: string; copyObject: boolean }
  ) => {
    const ext = p.scriptFileName.split(".").pop() ?? "";
    return `${p.toTestId}.${ext}`;
  }
);
vi.mock("../../src/lib/file-uploader.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/file-uploader.js")>();
  return {
    // Keep the real extension validator so file checks are exercised; stub the
    // S3 side effects.
    ...actual,
    uploadTestFile: (...args: unknown[]) => mockUploadTestFile(...args),
    copyScriptObject: (...args: unknown[]) => mockCopyScriptObject(...args),
    copyScenarioScript: (
      ...args: [
        unknown,
        { testType: string; fromTestId: string; toTestId: string; scriptFileName: string; copyObject: boolean },
      ]
    ) => mockCopyScenarioScript(...args),
  };
});

import { registerScenariosCommand } from "../../src/commands/scenarios.js";
import { registerRunsCommand } from "../../src/commands/runs.js";
import { printResult } from "../../src/lib/output.js";

describe("scenarios delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("deletes a scenario by testId", async () => {
    mockApiDelete.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "delete", "t1"]);

    expect(mockApiDelete).toHaveBeenCalledWith("/scenarios/t1");
  });

  it("handles not-found error", async () => {
    mockApiDelete.mockRejectedValue(new Error("API returned HTTP 404: Not Found"));

    const program = createProgram();
    await expect(program.parseAsync(["node", "dlt", "scenarios", "delete", "nonexistent"])).rejects.toThrow(
      "API returned HTTP 404"
    );
  });
});

describe("scenarios cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("cancels a running scenario", async () => {
    mockApiGet.mockResolvedValue({ status: "running" });
    mockApiPost.mockResolvedValue({ status: "cancelling" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "cancel", "t1"]);

    expect(mockApiPost).toHaveBeenCalledWith("/scenarios/t1", {});
  });

  it("prints the resulting status", async () => {
    mockApiGet.mockResolvedValue({ status: "running" });
    mockApiPost.mockResolvedValue({ status: "cancelled" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "cancel", "t1"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("cancelled"));
  });

  it("rejects cancel when scenario is in a terminal state", async () => {
    mockApiGet.mockResolvedValue({ status: "complete" });

    const program = createProgram();
    await expect(program.parseAsync(["node", "dlt", "scenarios", "cancel", "t1"])).rejects.toThrow(
      "Cannot cancel scenario t1: test is not in a cancelable state"
    );
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("allows a repeat cancel while already cancelling (idempotent)", async () => {
    mockApiGet.mockResolvedValue({ status: "cancelling" });
    mockApiPost.mockResolvedValue({ status: "cancelling" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "cancel", "t1"]);

    expect(mockApiPost).toHaveBeenCalledWith("/scenarios/t1", {});
  });

  it("rejects cancel during the finishing states (parsing results)", async () => {
    mockApiGet.mockResolvedValue({ status: "parsing results" });

    const program = createProgram();
    await expect(program.parseAsync(["node", "dlt", "scenarios", "cancel", "t1"])).rejects.toThrow(
      "Cannot cancel scenario t1: test is not in a cancelable state"
    );
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

describe("scenarios update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("fetches existing scenario, merges options, and posts update", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--concurrency", "20", "--hold-for", "10m"]);

    expect(mockApiGet).toHaveBeenCalledWith("/scenarios/t1?history=false&latest=false");
    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        testId: "t1",
        saveOnly: true,
        testScenario: expect.objectContaining({
          execution: [expect.objectContaining({ concurrency: 20, "hold-for": "10m" })],
        }),
      })
    );
  });

  it("trims surrounding whitespace from the name on update", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: {
        execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m", scenario: "Original" }],
        scenarios: { Original: { requests: [{ url: "https://example.com", method: "GET", headers: {} }] } },
      },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--test-name", "  Padded Name  "]);

    expect(mockApiPost).toHaveBeenCalledWith("/scenarios", expect.objectContaining({ testName: "Padded Name" }));
  });

  it("re-keys the scenarios map and execution.scenario when renaming", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: {
        execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m", scenario: "Original" }],
        scenarios: { Original: { requests: [{ url: "https://example.com", method: "GET", headers: {} }] } },
      },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--test-name", "New Name"]);

    // Exact scenarios object: "New Name" is the only key, so "Original" was re-keyed away.
    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        testName: "New Name",
        testScenario: expect.objectContaining({
          execution: [expect.objectContaining({ scenario: "New Name" })],
          scenarios: { "New Name": { requests: [{ url: "https://example.com", method: "GET", headers: {} }] } },
        }),
      })
    );
  });

  it("updates regions", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Test",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--regions", "us-west-2,eu-west-1"]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        testTaskConfigs: [
          expect.objectContaining({ region: "us-west-2" }),
          expect.objectContaining({ region: "eu-west-1" }),
        ],
      })
    );
  });

  it("prints confirmation with format", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Test",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{}] },
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--test-name", "New Name"]);

    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({ testId: "t1", status: "updated" }),
      expect.anything()
    );
  });

  it("updates ramp-up time", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Test",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--ramp-up", "30s"]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        testScenario: expect.objectContaining({
          execution: [expect.objectContaining({ "ramp-up": "30s" })],
        }),
      })
    );
  });

  it("includes regionalTaskDetails in the update payload", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Test",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 2 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--hold-for", "3m"]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 2 } },
      })
    );
  });

  it("handles file upload during update", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Test",
      testDescription: "Desc",
      testType: "jmeter",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 1, taskCount: 1 }],
      testScenario: { execution: [{}] },
    });
    mockUploadTestFile.mockResolvedValue({ key: "public/test-scenarios/jmeter/t1.jmx", fileType: "script" });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--file", "/tmp/test.jmx"]);

    expect(mockUploadTestFile).toHaveBeenCalled();
    expect(mockApiPost).toHaveBeenCalledWith("/scenarios", expect.objectContaining({ fileType: "script" }));
  });

  it("rejects an invalid update payload with a client-side error naming the offending field", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
    });

    // "ab" is too short for the shared createTestSchema (min 3), so the merged
    // update payload fails validation locally before being sent.
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--test-name", "ab"])
    ).rejects.toThrow(/testName/);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  const nativeLocustScenario = {
    testId: "n1",
    testName: "Locust Native",
    testDescription: "Native run",
    testType: "locust",
    fileType: "script",
    showLive: false,
    testTaskConfigs: [{ region: "us-east-1", concurrency: 1, taskCount: 2 }],
    testScenario: { execution: [{ concurrency: 1, "ramp-up": "0s", "hold-for": "1s", executor: "locust" }] },
    tags: [],
    nativeRunMode: { maxTestDurationSeconds: 1800 },
  };

  it("preserves native mode when unrelated fields are updated", async () => {
    mockApiGet.mockResolvedValue(nativeLocustScenario);
    mockApiPost.mockResolvedValue({ testId: "n1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "n1", "--task-count", "4"]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        nativeRunMode: { maxTestDurationSeconds: 1800 },
      })
    );
  });

  it("changes the native safety timeout", async () => {
    mockApiGet.mockResolvedValue(nativeLocustScenario);
    mockApiPost.mockResolvedValue({ testId: "n1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "n1", "--max-test-duration", "45m"]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        nativeRunMode: { maxTestDurationSeconds: 2700 },
      })
    );
  });

  it("strips a legacy loadOverrides field from an existing native scenario on update", async () => {
    // A legacy record may still carry loadOverrides; update rebuilds nativeRunMode
    // with only the safety timeout, so the persisted record is cleaned.
    mockApiGet.mockResolvedValue({
      ...nativeLocustScenario,
      nativeRunMode: { maxTestDurationSeconds: 1800, loadOverrides: { locustLoadOverrides: { users: 500 } } },
    });
    mockApiPost.mockResolvedValue({ testId: "n1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "n1", "--task-count", "4"]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        nativeRunMode: { maxTestDurationSeconds: 1800 },
      })
    );
  });

  it("replaces tags and sets healthy threshold from flags", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: ["old"],
      healthyThreshold: 90,
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync([
      "node", "dlt", "scenarios", "update", "t1", "--tags", "new1,new2", "--healthy-threshold", "80",
    ]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({ tags: ["new1", "new2"], healthyThreshold: 80 })
    );
  });

  it("preserves existing tags when --tags is omitted", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: ["keep"],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--concurrency", "9"]);

    expect(mockApiPost).toHaveBeenCalledWith("/scenarios", expect.objectContaining({ tags: ["keep"] }));
  });

  it("applies fields from a --from-file spec on top of the existing scenario", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: ["old"],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const specPath = writeSpec({ concurrency: 25, tags: ["fromspec"] });
    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--from-file", specPath]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        tags: ["fromspec"],
        testScenario: expect.objectContaining({ execution: [expect.objectContaining({ concurrency: 25 })] }),
      })
    );
  });

  it("--dry-run previews the merged body without posting", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--concurrency", "20", "--dry-run"]);

    // Existing scenario is fetched, but no update is posted.
    expect(mockApiGet).toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({
        testId: "t1",
        saveOnly: true,
        testScenario: expect.objectContaining({
          execution: [expect.objectContaining({ concurrency: 20 })],
        }),
      }),
      expect.anything()
    );
  });

  it("applies cron scheduling, including --cron-expiry-date", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "dlt",
      "scenarios",
      "update",
      "t1",
      "--cron",
      "0 8 * * *",
      "--cron-expiry-date",
      "2027-01-01",
    ]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        scheduleStep: "create",
        cronValue: "0 8 * * *",
        scheduleTimezone: "UTC",
        cronExpiryDate: "2027-01-01",
      })
    );
    // A scheduled write must NOT be save-only, or the fired run never launches.
    expect(mockApiPost.mock.calls[0]![1]).not.toHaveProperty("saveOnly");
  });

  it("preserves an existing recurring schedule when updating an unrelated field", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      status: "scheduled",
      nextRun: "2027-09-16 08:00:00",
      cronValue: "0 8 * * *",
      cronExpiryDate: "2027-12-31",
      scheduleTimezone: "US/Pacific",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--concurrency", "3"]);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/scenarios",
      expect.objectContaining({
        scheduleStep: "create",
        cronValue: "0 8 * * *",
        cronExpiryDate: "2027-12-31",
        scheduleTimezone: "US/Pacific",
      })
    );
    expect(mockApiPost.mock.calls[0]![1]).not.toHaveProperty("saveOnly");
  });

  it("lets a lone --cron-expiry-date override the preserved recurring schedule", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      status: "scheduled",
      nextRun: "2027-09-16 08:00:00",
      cronValue: "0 8 * * *",
      cronExpiryDate: "2027-12-31",
      scheduleTimezone: "UTC",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--cron-expiry-date", "2028-06-30"]);

    const body = mockApiPost.mock.calls[0]![1] as Record<string, unknown>;
    // cron preserved, expiry overridden by the new flag (not silently ignored).
    expect(body).toMatchObject({ scheduleStep: "create", cronValue: "0 8 * * *", cronExpiryDate: "2028-06-30" });
  });

  it("lets a lone --schedule-timezone override the preserved schedule", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      status: "scheduled",
      nextRun: "2027-09-16 08:00:00",
      cronValue: "0 8 * * *",
      scheduleTimezone: "UTC",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--schedule-timezone", "US/Pacific"]);

    const body = mockApiPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ scheduleStep: "create", cronValue: "0 8 * * *", scheduleTimezone: "US/Pacific" });
  });

  it("preserves an existing one-time schedule (from the API's scheduleDate/scheduleTime) on an unrelated update", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      status: "scheduled",
      // The API derives scheduleDate/scheduleTime from nextRun and returns both.
      nextRun: "2027-06-01 09:30:00",
      scheduleDate: "2027-06-01",
      scheduleTime: "09:30",
      cronValue: "",
      scheduleTimezone: "UTC",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--concurrency", "3"]);

    const body = mockApiPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({
      scheduleStep: "start",
      scheduleDate: "2027-06-01",
      scheduleTime: "09:30",
      scheduleTimezone: "UTC",
    });
    expect(body).not.toHaveProperty("cronValue");
    expect(body).not.toHaveProperty("saveOnly");
  });

  it("lets explicit schedule flags replace an existing schedule (recurring -> one-time)", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      status: "scheduled",
      nextRun: "2027-09-16 08:00:00",
      cronValue: "0 8 * * *",
      scheduleTimezone: "UTC",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "dlt",
      "scenarios",
      "update",
      "t1",
      "--schedule-date",
      "2028-01-15",
      "--schedule-time",
      "14:30",
    ]);

    const body = mockApiPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ scheduleStep: "start", scheduleDate: "2028-01-15", scheduleTime: "14:30" });
    expect(body).not.toHaveProperty("cronValue");
    expect(body).not.toHaveProperty("saveOnly");
  });

  it("does not resurrect a schedule for a non-scheduled scenario", async () => {
    mockApiGet.mockResolvedValue({
      testId: "t1",
      testName: "Original",
      testDescription: "Desc",
      testType: "simple",
      fileType: "none",
      showLive: false,
      status: "complete",
      nextRun: "2020-01-01 09:00:00",
      cronValue: "",
      scheduleTimezone: "UTC",
      testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 1 }],
      testScenario: { execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m" }] },
      tags: [],
    });
    mockApiPost.mockResolvedValue({ testId: "t1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "update", "t1", "--concurrency", "3"]);

    const body = mockApiPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("scheduleStep");
    expect(body).not.toHaveProperty("scheduleDate");
    expect(body).not.toHaveProperty("cronValue");
    // A non-scheduled update stays save-only (must not start a run).
    expect(body).toMatchObject({ saveOnly: true });
  });
});

describe("scenarios results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  const mockRunWithResults = {
    testRunId: "r1",
    status: "completed",
    results: {
      total: {
        avg_rt: "0.250",
        p50_0: "0.200",
        p95_0: "0.400",
        p99_0: "0.500",
        succ: 900,
        fail: 100,
        throughput: 50,
      },
    },
  };

  it("fetches latest run and prints formatted results in table format", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1"]);

    expect(mockApiGet).toHaveBeenCalledWith("/scenarios/t1/testruns?limit=1&latest=true");
    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({
        avgResponseTime: 250,
        p50: 200,
        p99: 500,
        errorRate: 10,
        totalRequests: 1000,
        throughput: 50,
      }),
      expect.objectContaining({ format: "table" })
    );
  });

  it("outputs results in JSON format with --json", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--json"]);

    expect(printResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "json" }));
  });

  it("outputs results in CSV format with --csv", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--csv"]);

    expect(printResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "csv" }));
  });

  it("outputs results in table format with --format table", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--format", "table"]);

    expect(printResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "table" }));
  });

  it("outputs results in JSON format with --format json", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--format", "json"]);

    expect(printResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "json" }));
  });

  it("outputs results in CSV format with --format csv", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--format", "csv"]);

    expect(printResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "csv" }));
  });

  it("throws when --json and --csv are both provided", async () => {
    const program = createProgram();
    await expect(program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--json", "--csv"])).rejects.toThrow(
      "--json and --csv are mutually exclusive"
    );
  });

  it("throws when an alias disagrees with an explicit --format value", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--json", "--format", "csv"])
    ).rejects.toThrow("--json conflicts with --format csv");
  });

  it("accepts an alias that agrees with an explicit --format value", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--json", "--format", "json"]);

    expect(printResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "json" }));
  });

  it("throws when no completed run is found", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [] });

    const program = createProgram();
    await expect(program.parseAsync(["node", "dlt", "scenarios", "results", "t1"])).rejects.toThrow(
      "No completed run found"
    );
  });

  it("throws when latest run is not in completed status", async () => {
    mockApiGet.mockResolvedValue({
      testRuns: [{ testRunId: "r1", status: "running", results: {} }],
    });

    const program = createProgram();
    await expect(program.parseAsync(["node", "dlt", "scenarios", "results", "t1"])).rejects.toThrow(
      "No completed run found"
    );
  });

  it("sets exit code 2 when threshold is breached", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-error-rate", "5"]);

    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it("does not breach when threshold is not exceeded", async () => {
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-error-rate", "50"]);

    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });

  it("breaches an ms latency threshold against nested seconds-format data", async () => {
    // mockRunWithResults.results.total.p99_0 = "0.500" (seconds) = 500ms.
    // --fail-on-p99 300 must breach (500ms > 300ms). Before the units fix this
    // compared 0.5 > 300 and silently passed.
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-p99", "300"]);

    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it("does not breach an ms latency threshold above the nested seconds-format value", async () => {
    // p99 = 500ms, threshold 1000ms → no breach.
    mockApiGet.mockResolvedValue({ testRuns: [mockRunWithResults] });

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-p99", "1000"]);

    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });

  it("evaluates baseline regression and skips when no baseline is set", async () => {
    mockApiGet
      .mockResolvedValueOnce({ testRuns: [mockRunWithResults] })
      .mockResolvedValueOnce({ testId: "t1", baselineId: null, message: "No baseline" });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-baseline-regression", "10"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No baseline is set"));
    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });

  it("handles the flat API response format (no results.total nesting)", async () => {
    // The /testruns endpoint returns a flat structure with percentiles sub-object
    const flatRun = {
      testRunId: "r2",
      status: "complete",
      success: 10000,
      errors: 0,
      avgResponseTime: 5.5,
      requestsPerSecond: 180,
      percentiles: { p50: 5, p90: 7, p95: 8, p99: 10 },
    };
    mockApiGet.mockResolvedValue({ testRuns: [flatRun] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1"]);

    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({
        avgResponseTime: 5.5,
        p50: 5,
        p99: 10,
        errorRate: 0,
        totalRequests: 10000,
        throughput: 180,
      }),
      expect.anything()
    );
  });

  it("normalizes baseline data from seconds to ms before regression comparison", async () => {
    // Current run in flat format (ms)
    const flatRun = {
      testRunId: "r3",
      status: "complete",
      success: 10000,
      errors: 0,
      avgResponseTime: 5.5,
      requestsPerSecond: 180,
      percentiles: { p50: 5, p90: 7, p95: 8, p99: 10 },
    };
    // Baseline in nested format (seconds) — similar values so no regression
    const baselineResp = {
      testId: "t1",
      baselineId: "baseline-r1",
      testRunDetails: {
        results: {
          total: {
            avg_rt: "0.0055",
            p50_0: "0.005",
            p90_0: "0.007",
            p95_0: "0.008",
            p99_0: "0.010",
            succ: 10000,
            fail: 0,
            throughput: 10800,
            testDuration: "60",
          },
        },
      },
    };
    mockApiGet.mockResolvedValueOnce({ testRuns: [flatRun] }).mockResolvedValueOnce(baselineResp);

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-baseline-regression", "20"]);

    // Values are similar (5.5ms vs 5.5ms baseline), should NOT breach
    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });
});

describe("scenarios start with threshold flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("evaluates thresholds after --wait completes and sets exit code 2 on breach", async () => {
    mockStartScenario.mockResolvedValue({ testId: "t1", status: "running" });
    // First call: poll scenario status — completed
    // Second call: fetch final run results (reused for threshold evaluation)
    mockApiGet.mockResolvedValueOnce({ testId: "t1", status: "completed" }).mockResolvedValueOnce({
      testRuns: [
        {
          testRunId: "r1",
          status: "completed",
          results: {
            total: { avg_rt: "0.250", p50_0: "0.200", p99_0: "0.500", succ: 900, fail: 100, throughput: 50 },
          },
        },
      ],
    });

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "start", "t1", "--wait", "--fail-on-error-rate", "5"]);

    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it("evaluates thresholds with flat run format after --wait", async () => {
    mockStartScenario.mockResolvedValue({ testId: "t1", status: "running" });
    // Poll returns complete
    mockApiGet.mockResolvedValueOnce({ testId: "t1", status: "complete" }).mockResolvedValueOnce({
      testRuns: [
        {
          testRunId: "r2",
          status: "complete",
          success: 1000,
          errors: 200,
          avgResponseTime: 5.0,
          requestsPerSecond: 100,
          percentiles: { p50: 4, p90: 6, p95: 8, p99: 12 },
        },
      ],
    });

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "start", "t1", "--wait", "--fail-on-error-rate", "10"]);

    // 200/(1000+200) = 16.67% > 10%
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });
});

describe("runs delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerRunsCommand(program);
    return program;
  }

  it("deletes a single run", async () => {
    mockApiDelete.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "runs", "delete", "t1", "--run-id", "r1"]);

    expect(mockApiDelete).toHaveBeenCalledWith("/scenarios/t1/testruns", ["r1"]);
  });

  it("deletes multiple runs", async () => {
    mockApiDelete.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "runs", "delete", "t1", "--run-id", "r1", "--run-id", "r2"]);

    expect(mockApiDelete).toHaveBeenCalledWith("/scenarios/t1/testruns", ["r1", "r2"]);
  });
});

describe("runs baseline set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerRunsCommand(program);
    return program;
  }

  it("sets a baseline run", async () => {
    mockApiPut.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "runs", "baseline", "set", "t1", "--run-id", "r1"]);

    expect(mockApiPut).toHaveBeenCalledWith("/scenarios/t1/baseline", { testRunId: "r1" });
  });
});

describe("runs baseline clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerRunsCommand(program);
    return program;
  }

  it("clears the baseline", async () => {
    mockApiDelete.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "runs", "baseline", "clear", "t1"]);

    expect(mockApiDelete).toHaveBeenCalledWith("/scenarios/t1/baseline");
  });
});

describe("scenarios results — baseline regression edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  const flatRun = {
    testRunId: "r1",
    status: "complete",
    success: 10000,
    errors: 0,
    avgResponseTime: 5.5,
    requestsPerSecond: 180,
    percentiles: { p50: 5, p90: 7, p95: 8, p99: 10 },
  };

  it("warns and skips when baseline run has no results data", async () => {
    mockApiGet
      .mockResolvedValueOnce({ testRuns: [flatRun] })
      .mockResolvedValueOnce({ testId: "t1", baselineId: "b1", testRunDetails: { results: {} } });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-baseline-regression", "10"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Baseline run has no results data"));
    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });

  it("retries once then succeeds when baseline fetch fails transiently", async () => {
    const baselineResp = {
      testId: "t1",
      baselineId: "b1",
      testRunDetails: {
        results: {
          total: {
            avg_rt: "0.0055",
            p50_0: "0.005",
            p90_0: "0.007",
            p95_0: "0.008",
            p99_0: "0.010",
            succ: 10000,
            fail: 0,
            throughput: 10800,
            testDuration: "60",
          },
        },
      },
    };
    mockApiGet
      .mockResolvedValueOnce({ testRuns: [flatRun] }) // results fetch
      .mockRejectedValueOnce(new Error("throttled")) // baseline attempt 1 fails
      .mockResolvedValueOnce(baselineResp); // baseline attempt 2 succeeds

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-baseline-regression", "20"]);

    // Similar values → no regression, and the retry succeeded so no exit 3
    expect(process.exitCode).not.toBe(2);
    expect(process.exitCode).not.toBe(3);
    process.exitCode = 0;
  });

  it("sets exit code 3 when baseline fetch fails on all attempts", async () => {
    mockApiGet
      .mockResolvedValueOnce({ testRuns: [flatRun] }) // results fetch
      .mockRejectedValueOnce(new Error("throttled")) // baseline attempt 1
      .mockRejectedValueOnce(new Error("throttled")); // baseline attempt 2

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-baseline-regression", "20"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Baseline fetch failed after"));
    expect(process.exitCode).toBe(3);
    process.exitCode = 0;
  });

  it("preserves exit code 3 (baseline fetch failed) even when a direct threshold also breaches", async () => {
    // flatRun p99 = 10ms; --fail-on-p99 5 breaches (would set 2). Baseline fetch
    // fails (sets 3). The more severe code 3 must not be downgraded to 2.
    mockApiGet
      .mockResolvedValueOnce({ testRuns: [flatRun] }) // results fetch
      .mockRejectedValueOnce(new Error("throttled")) // baseline attempt 1
      .mockRejectedValueOnce(new Error("throttled")); // baseline attempt 2

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync([
      "node",
      "dlt",
      "scenarios",
      "results",
      "t1",
      "--fail-on-p99",
      "5",
      "--fail-on-baseline-regression",
      "20",
    ]);

    expect(process.exitCode).toBe(3);
    process.exitCode = 0;
  });
});

describe("scenarios start --wait — multi-test threshold evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  const breachingRun = (runId: string) => ({
    testRunId: runId,
    status: "complete",
    success: 800,
    errors: 200, // 20% error rate
    avgResponseTime: 5.0,
    requestsPerSecond: 100,
    percentiles: { p50: 4, p90: 6, p95: 8, p99: 12 },
  });

  it("evaluates thresholds for every started test, not just the first", async () => {
    // Distinct IDs matching the command args so startedIds is Set {"t1","t2"}
    mockStartScenario
      .mockResolvedValueOnce({ testId: "t1", status: "running" })
      .mockResolvedValueOnce({ testId: "t2", status: "running" });
    // Poll t1 -> complete, poll t2 -> complete, then results for t1 and t2
    mockApiGet
      .mockResolvedValueOnce({ testId: "t1", status: "completed" })
      .mockResolvedValueOnce({ testId: "t2", status: "completed" })
      .mockResolvedValueOnce({ testRuns: [breachingRun("r1")] })
      .mockResolvedValueOnce({ testRuns: [breachingRun("r2")] });

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "start", "t1", "t2", "--wait", "--fail-on-error-rate", "5"]);

    // Both tests breach 5% error rate → exit code 2
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it("skips a test whose final run cannot be fetched", async () => {
    mockStartScenario.mockResolvedValueOnce({ testId: "t1", status: "running" });
    mockApiGet
      .mockResolvedValueOnce({ testId: "t1", status: "completed" })
      .mockRejectedValueOnce(new Error("run fetch failed")); // final run fetch throws → skipped

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "start", "t1", "--wait", "--fail-on-error-rate", "5"]);

    // No run data → no breach, no crash
    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });
});

describe("scenarios start --wait — polling and threshold-eval resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("logs 'still running' while a test remains active across poll cycles", async () => {
    mockStartScenario.mockResolvedValue({ testId: "t1", status: "running" });
    // First poll: still running (stays pending -> triggers "Still running" branch)
    // Second poll: completed
    // Then: fetch final run results
    mockApiGet
      .mockResolvedValueOnce({ testId: "t1", status: "running" })
      .mockResolvedValueOnce({ testId: "t1", status: "completed" })
      .mockResolvedValueOnce({
        testRuns: [{ testRunId: "r1", status: "completed", success: 100, errors: 0, requestsPerSecond: 50 }],
      });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "start", "t1", "--wait"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Still running"));
  });

  it("handles a baseline total missing testDuration during normalization", async () => {
    const flatRun = {
      testRunId: "r1",
      status: "complete",
      success: 10000,
      errors: 0,
      avgResponseTime: 5.5,
      requestsPerSecond: 180,
      percentiles: { p50: 5, p90: 7, p95: 8, p99: 10 },
    };
    // Baseline total has no testDuration → parseBaselineNumeric(undefined) path
    const baselineResp = {
      testId: "t1",
      baselineId: "b1",
      testRunDetails: {
        results: {
          total: {
            avg_rt: "0.0055",
            p50_0: "0.005",
            p90_0: "0.007",
            p95_0: "0.008",
            p99_0: "0.010",
            succ: 10000,
            fail: 0,
          },
        },
      },
    };
    mockApiGet.mockResolvedValueOnce({ testRuns: [flatRun] }).mockResolvedValueOnce(baselineResp);

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-baseline-regression", "20"]);

    // Latency values match closely → no regression breach
    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });

  it("does not report a false throughput regression when baseline has throughput but no testDuration", async () => {
    // Current run reports throughput in req/s (180). Baseline stores throughput
    // as total requests (10800) and has no testDuration to convert it to req/s.
    // Without the fix, 180 would be compared against 10800 → massive false
    // regression breach. The unconvertible throughput must be dropped so the
    // comparison is skipped.
    const flatRun = {
      testRunId: "r1",
      status: "complete",
      success: 10000,
      errors: 0,
      avgResponseTime: 5.5,
      requestsPerSecond: 180,
      percentiles: { p50: 5, p90: 7, p95: 8, p99: 10 },
    };
    const baselineResp = {
      testId: "t1",
      baselineId: "b1",
      testRunDetails: {
        results: {
          total: {
            avg_rt: "0.0055",
            p50_0: "0.005",
            p90_0: "0.007",
            p95_0: "0.008",
            p99_0: "0.010",
            succ: 10000,
            fail: 0,
            throughput: 10800, // total requests, NOT req/s
            // no testDuration → cannot convert to req/s
          },
        },
      },
    };
    mockApiGet.mockResolvedValueOnce({ testRuns: [flatRun] }).mockResolvedValueOnce(baselineResp);

    const program = createProgram();
    process.exitCode = 0;
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1", "--fail-on-baseline-regression", "20"]);

    // Throughput comparison skipped; latency matches → no breach.
    expect(process.exitCode).not.toBe(2);
    process.exitCode = 0;
  });
});

describe("scenarios results — full metric formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("formats all metric fields from a nested results.total (seconds → ms)", async () => {
    const run = {
      testRunId: "r1",
      status: "completed",
      results: {
        total: {
          avg_rt: "0.250",
          avg_lt: "0.240",
          avg_ct: "0.010",
          p0_0: "0.100",
          p50_0: "0.200",
          p90_0: "0.350",
          p95_0: "0.400",
          p99_0: "0.500",
          p99_9: "0.550",
          p100_0: "0.600",
          stdev_rt: "0.050",
          succ: 900,
          fail: 100,
          throughput: 50,
          testDuration: "120", // string → exercises toNum string branch
          bytes: "2048", // string → exercises toNum string branch
        },
      },
    };
    mockApiGet.mockResolvedValue({ testRuns: [run] });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1"]);

    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({
        avgResponseTime: 250,
        avgLatency: 240,
        avgConnectionTime: 10,
        p0: 100,
        p50: 200,
        p90: 350,
        p95: 400,
        p99: 500,
        p999: 550,
        p100: 600,
        stdDevResponseTime: 50,
        errorRate: 10,
        successCount: 900,
        errorCount: 100,
        totalRequests: 1000,
        throughput: 50,
        testDuration: 120,
        bytesAvg: 2048,
      }),
      expect.objectContaining({ format: "table" })
    );
  });

  it("returns empty results object when run has no recognizable metrics", async () => {
    // Run with neither results.total nor flat success/errors → extractTotalResults returns {}
    mockApiGet.mockResolvedValue({
      testRuns: [{ testRunId: "r1", status: "completed" }],
    });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "results", "t1"]);

    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({ totalRequests: 0, errorRate: 0, throughput: 0 }),
      expect.anything()
    );
  });
});

describe("scenarios spec-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("prints a valid JSON spec for the requested test type", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "spec-template", "--test-type", "jmeter"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const spec = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(spec).toMatchObject({ testType: "jmeter", file: "./path/to/script.jmx", concurrency: 10 });
    logSpy.mockRestore();
  });

  it("prints native-mode fields with --native-mode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "spec-template", "--test-type", "k6", "--native-mode"]);

    const spec = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(spec).toMatchObject({ nativeMode: true, maxTestDuration: "30m" });
    expect(spec).not.toHaveProperty("k6Vus");
    logSpy.mockRestore();
  });

  it("rejects --native-mode for a simple template", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "dlt", "scenarios", "spec-template", "--test-type", "simple", "--native-mode"])
    ).rejects.toThrow(/only supported for jmeter, k6, and locust/);
  });
});

describe("scenarios copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  const simpleScenario = {
    testId: "src1",
    testName: "Source Test",
    testDescription: "the source",
    testType: "simple",
    fileType: "none",
    showLive: false,
    testTaskConfigs: [{ region: "us-east-1", concurrency: 5, taskCount: 2 }],
    testScenario: {
      execution: [{ concurrency: 5, "ramp-up": "0s", "hold-for": "5m", scenario: "Source Test" }],
      scenarios: { "Source Test": { requests: [{ url: "https://example.com", method: "GET", headers: {} }] } },
    },
    tags: ["orig"],
    healthyThreshold: 90,
  };

  it("duplicates a simple scenario under a new testId, saved and not started", async () => {
    mockApiGet.mockResolvedValue(simpleScenario);
    mockApiPost.mockResolvedValue({ testId: "new1" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "copy", "src1"]);

    expect(mockCopyScenarioScript).not.toHaveBeenCalled();
    const [, body] = mockApiPost.mock.calls[0]!;
    expect(body.testId).not.toBe("src1");
    expect(body.testName).toBe("Source Test");
    expect(body.saveOnly).toBe(true);
    expect(body.tags).toEqual(["orig"]);
  });

  it("renames the copy and re-keys the scenarios map with --test-name", async () => {
    mockApiGet.mockResolvedValue(simpleScenario);
    mockApiPost.mockResolvedValue({ testId: "new2" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "copy", "src1", "--test-name", "Copied Test"]);

    const [, body] = mockApiPost.mock.calls[0]!;
    expect(body.testName).toBe("Copied Test");
    expect(body.testScenario.execution[0].scenario).toBe("Copied Test");
    expect(Object.keys(body.testScenario.scenarios)).toEqual(["Copied Test"]);
  });

  const jmeterScenario = {
    testId: "srcJ",
    testName: "JMeter Source",
    testDescription: "jmeter source",
    testType: "jmeter",
    fileType: "script",
    showLive: false,
    testTaskConfigs: [{ region: "us-east-1", concurrency: 1, taskCount: 1 }],
    testScenario: {
      execution: [{ concurrency: 1, "ramp-up": "0s", "hold-for": "5m", scenario: "JMeter Source", executor: "jmeter" }],
      scenarios: { "JMeter Source": { script: "srcJ.jmx" } },
    },
    tags: [],
  };

  it("copies the script object and repoints it to the new testId for script tests", async () => {
    mockApiGet.mockResolvedValue(jmeterScenario);
    mockApiPost.mockResolvedValue({ testId: "newJ" });

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "copy", "srcJ"]);

    expect(mockCopyScenarioScript).toHaveBeenCalledTimes(1);
    const [, params] = mockCopyScenarioScript.mock.calls[0]!;
    expect(params.testType).toBe("jmeter");
    expect(params.fromTestId).toBe("srcJ");
    expect(params.toTestId).toMatch(/^[a-f0-9]{10}$/);
    expect(params.scriptFileName).toBe("srcJ.jmx");
    expect(params.copyObject).toBe(true);

    const [, body] = mockApiPost.mock.calls[0]!;
    const script = body.testScenario.scenarios["JMeter Source"].script;
    expect(script).toMatch(/^[a-f0-9]{10}\.jmx$/);
    expect(script).not.toBe("srcJ.jmx");
  });

  it("--dry-run skips the S3 copy and the POST", async () => {
    mockApiGet.mockResolvedValue(jmeterScenario);

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "scenarios", "copy", "srcJ", "--dry-run"]);

    // The new script filename is still computed for the preview, but with
    // copyObject false so no S3 copy is performed.
    expect(mockCopyScenarioScript).toHaveBeenCalledTimes(1);
    expect(mockCopyScenarioScript.mock.calls[0]![1].copyObject).toBe(false);
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(printResult).toHaveBeenCalledWith(expect.objectContaining({ testType: "jmeter" }), expect.anything());
  });
});
