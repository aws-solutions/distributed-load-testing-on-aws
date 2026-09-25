// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { LogEvent } from "@amzn/dlt-common";
import type { S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EcsTaskMetadata } from "../../src/ecs-metadata.js";
import type { RunnerConfig } from "../../src/env.js";
import { installLocustDependencies } from "../../src/locust/install-dependencies.js";
import type { Logger } from "../../src/logger.js";
import { superviseProcess } from "../../src/process/process-supervisor.js";
import { LocustRunner } from "../../src/runners/locust.js";
import type { RunnerRunResult } from "../../src/runners/runner.js";

vi.mock("../../src/process/process-supervisor.js", () => ({
  superviseProcess: vi.fn(),
}));

vi.mock("../../src/locust/install-dependencies.js", () => ({
  installLocustDependencies: vi.fn(),
}));

const superviseMock = vi.mocked(superviseProcess);
const installMock = vi.mocked(installLocustDependencies);

const HEADER =
  "timestamp,method,name,response_time_ms,response_length_bytes,status_code,success," +
  "exception_type,exception_message,user_count,context_json";

let artifactsDir: string;
let scriptPath: string;

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    testId: "test-123",
    framework: "locust",
    awsRegion: "us-east-1",
    liveDataEnabled: true,
    testScriptPath: scriptPath,
    artifactsDir,
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<EcsTaskMetadata> = {}): EcsTaskMetadata {
  return {
    taskArn: "arn:aws:ecs:us-east-1:123456789012:task/cluster/abc123",
    taskId: "abc123",
    taskCpu: 2,
    taskMemory: 4096,
    startedAt: "2026-05-14T10:00:00Z",
    ...overrides,
  };
}

function makeRunResult(overrides: Partial<RunnerRunResult> = {}): RunnerRunResult {
  return {
    exitCode: 0,
    stderrTail: "",
    stopReason: "natural",
    startedAt: new Date("2026-05-14T10:01:00Z"),
    endedAt: new Date("2026-05-14T10:02:00Z"),
    artifacts: {},
    ...overrides,
  };
}

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

/** Runs prepare() so the runner knows where kpi.csv lives, then returns it. */
async function preparedRunner(config = makeConfig(), logger = makeLogger()): Promise<LocustRunner> {
  const runner = new LocustRunner(logger);
  // s3Client/scenariosBucket exist for runners that install their framework from
  // a bundle DLT ships (JMeter). Locust is pip-installed at image build time and
  // reads neither.
  await runner.prepare({
    env: config,
    taskMetadata: makeMetadata(),
    s3Client: {} as S3Client,
    scenariosBucket: "scenarios-bucket",
  });
  return runner;
}

function writeKpiCsv(...lines: readonly string[]): void {
  fs.writeFileSync(path.join(artifactsDir, "kpi.csv"), `${[HEADER, ...lines].join("\n")}\n`);
}

describe("LocustRunner", () => {
  beforeEach(() => {
    superviseMock.mockReset();
    superviseMock.mockResolvedValue({ exitCode: 0, signal: null, stopReason: "natural", stderrTail: "" });
    installMock.mockReset();
    installMock.mockResolvedValue(undefined);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dlt-locust-test-"));
    artifactsDir = path.join(root, "artifacts");
    const workDir = path.join(root, "work");
    fs.mkdirSync(artifactsDir);
    fs.mkdirSync(workDir);
    scriptPath = path.join(workDir, "locustfile.py");
    fs.writeFileSync(scriptPath, "# locustfile\n");
  });

  afterEach(() => {
    fs.rmSync(path.dirname(artifactsDir), { recursive: true, force: true });
  });

  it('reports its name as "locust"', () => {
    expect(new LocustRunner(makeLogger()).name).toBe("locust");
  });

  describe("prepare", () => {
    it("installs the archive's custom dependencies beside the extracted script", async () => {
      await preparedRunner();

      expect(installMock).toHaveBeenCalledOnce();
      expect(installMock.mock.calls[0]?.[0]).toMatchObject({
        scriptDir: path.dirname(scriptPath),
        targetDir: path.join(path.dirname(scriptPath), ".dlt-dependencies"),
      });
    });

    it("logs a queryable task failure and rethrows when the install fails", async () => {
      const failure = new Error("Failed to install custom Python dependencies (pypi): ERROR: No matching distribution");
      installMock.mockRejectedValueOnce(failure);
      const logger = makeLogger();
      const runner = new LocustRunner(logger);

      await expect(
        runner.prepare({
          env: makeConfig(),
          taskMetadata: makeMetadata(),
          s3Client: {} as S3Client,
          scenariosBucket: "scenarios-bucket",
        })
      ).rejects.toBe(failure);

      expect(logger.error).toHaveBeenCalledWith(
        { err: failure, error: failure.message, logEvent: LogEvent.TASK_FAILED },
        "custom Python dependency installation failed"
      );
    });
  });

  describe("run", () => {
    it("puts the install directory on PYTHONPATH so the test's own packages import", async () => {
      installMock.mockResolvedValue("/tmp/work/scripts/.dlt-dependencies");
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(superviseMock.mock.calls[0]?.[0].env?.["PYTHONPATH"]).toBe("/tmp/work/scripts/.dlt-dependencies");
    });

    it("leaves PYTHONPATH alone when the archive declared no dependencies", async () => {
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(superviseMock.mock.calls[0]?.[0].env?.["PYTHONPATH"]).toBeUndefined();
    });

    it("prepends to a PYTHONPATH the container already set rather than replacing it", async () => {
      vi.stubEnv("PYTHONPATH", "/opt/dlt/extras");
      installMock.mockResolvedValue("/tmp/work/scripts/.dlt-dependencies");
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(superviseMock.mock.calls[0]?.[0].env?.["PYTHONPATH"]).toBe(
        `/tmp/work/scripts/.dlt-dependencies${path.delimiter}/opt/dlt/extras`
      );
      vi.unstubAllEnvs();
    });

    it("runs from the script's directory so relative imports resolve", async () => {
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(superviseMock.mock.calls[0]?.[0].cwd).toBe(path.dirname(scriptPath));
    });

    it("tells the sidecar where to write and which test this is", async () => {
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      const env = superviseMock.mock.calls[0]?.[0].env;
      expect(env?.["DLT_OUTPUT_DIR"]).toBe(artifactsDir);
      expect(env?.["DLT_TEST_ID"]).toBe("test-123");
    });

    it.each([
      [true, "true"],
      [false, "false"],
    ])('passes DLT_LIVE_DATA_ENABLED as "%s" when live data is %s', async (liveDataEnabled, expected) => {
      const config = makeConfig({ liveDataEnabled });
      const runner = await preparedRunner(config);
      await runner.run({
        env: config,
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(superviseMock.mock.calls[0]?.[0].env?.["DLT_LIVE_DATA_ENABLED"]).toBe(expected);
    });

    it("does not reuse the container's live=true spelling for the sidecar's variable", async () => {
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(superviseMock.mock.calls[0]?.[0].env?.["DLT_LIVE_DATA_ENABLED"]).not.toBe("live=true");
    });

    it("passes no load flags — the script controls its own load", async () => {
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      const args = superviseMock.mock.calls[0]?.[0].args ?? [];
      expect(args).not.toContain("--users");
      expect(args).not.toContain("--spawn-rate");
      expect(args).not.toContain("--run-time");
    });

    it("waits longer than Locust's own stop timeout before killing it", async () => {
      const runner = await preparedRunner();
      await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(superviseMock.mock.calls[0]?.[0].gracePeriodMs).toBeGreaterThan(10_000);
    });

    it("throws when locust isn't installed, since no test can run", async () => {
      superviseMock.mockResolvedValue({ exitCode: null, signal: null, stopReason: "natural", stderrTail: "" });
      const runner = await preparedRunner();

      await expect(
        runner.run({
          env: makeConfig(),
          taskMetadata: makeMetadata(),
          liveDataEmitter: { emit: vi.fn() },
          abortSignal: new AbortController().signal,
        })
      ).rejects.toThrow(/Failed to spawn locust/);
    });

    it("returns a non-zero exit code instead of throwing, so results still get reduced", async () => {
      superviseMock.mockResolvedValue({ exitCode: 1, signal: null, stopReason: "natural", stderrTail: "" });
      const runner = await preparedRunner();

      const result = await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stopReason).toBe("natural");
    });

    it.each([
      ["SIGKILL", 137],
      ["SIGTERM", 143],
    ])("reports a %s kill as exit code %i", async (signal, expected) => {
      superviseMock.mockResolvedValue({
        exitCode: null,
        signal: signal as NodeJS.Signals,
        stopReason: "killed",
        stderrTail: "",
      });
      const runner = await preparedRunner();

      const result = await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(result.exitCode).toBe(expected);
      expect(result.stopReason).toBe("killed");
    });

    it("reports where the sidecar's kpi.csv will be", async () => {
      const runner = await preparedRunner();

      const result = await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });

      expect(result.artifacts["kpiCsv"]).toBe(path.join(artifactsDir, "kpi.csv"));
    });
  });

  describe("reduce", () => {
    it("reads kpi.csv only after the framework has finished", async () => {
      const runner = await preparedRunner();
      const runResult = await runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      });
      writeKpiCsv("1700000000,GET,/after-run,100,1024,200,true,,,10,");

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        runResult,
      });

      expect(result.labels.map((label) => label.label)).toEqual(["/after-run"]);
    });

    it("aggregates the rows the sidecar wrote", async () => {
      writeKpiCsv(
        "1700000000,GET,/api,100,1024,200,true,,,10,",
        "1700000001,GET,/api,200,1024,200,true,,,10,",
        "1700000002,GET,/other,50,512,500,false,Error,boom,10,"
      );
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        runResult: makeRunResult(),
      });

      expect(result).toEqual(
        JSON.parse(fs.readFileSync(new URL("../fixtures/locust-result.json", import.meta.url), "utf8"))
      );
      expect(result.summary.totalRequestCount).toBe(3);
      expect(result.summary.successCount).toBe(2);
      expect(result.summary.failureCount).toBe(1);
      expect(result.labels.map((l) => l.label).sort()).toEqual(["/api", "/other"]);
    });

    it("returns an all-zero result when kpi.csv was never written", async () => {
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        runResult: makeRunResult(),
      });

      expect(result.summary.totalRequestCount).toBe(0);
      expect(result.labels).toEqual([]);
    });

    it("keeps valid rows when kpi.csv ends with a malformed row", async () => {
      writeKpiCsv("1700000000,GET,/api,100,1024,200,true,,,10,", "1700000001,GET,/cut-off");
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        runResult: makeRunResult(),
      });

      expect(result.summary.totalRequestCount).toBe(1);
    });

    it("returns a result rather than throwing when kpi.csv is a directory", async () => {
      // Stands in for any unreadable-file failure.
      fs.mkdirSync(path.join(artifactsDir, "kpi.csv"));
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        runResult: makeRunResult(),
      });

      expect(result.summary.totalRequestCount).toBe(0);
    });

    it("stamps the test's identity onto the result", async () => {
      writeKpiCsv("1700000000,GET,/api,100,1024,200,true,,,10,");
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        runResult: makeRunResult(),
      });

      expect(result.testId).toBe("test-123");
      expect(result.taskId).toBe("abc123");
      expect(result.region).toBe("us-east-1");
      expect(result.task.vcpus).toBe(2);
      expect(result.task.memoryMiB).toBe(4096);
    });

    it("measures ecsDurationSeconds from container start, not test start", async () => {
      // Container up at 10:00:00, test ran 10:01:00-10:02:00. The ECS duration
      // covers the whole container lifetime — 120s, including the minute spent
      // downloading the script and waiting for the start signal.
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata({ startedAt: "2026-05-14T10:00:00Z" }),
        runResult: makeRunResult(),
      });

      expect(result.task.ecsDurationSeconds).toBe(120);
      expect(result.testDurationSeconds).toBe(60);
    });

    it("falls back to 0 for ecsDurationSeconds when the container start time is unparseable", async () => {
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata({ startedAt: "not-a-date" }),
        runResult: makeRunResult(),
      });

      expect(result.task.ecsDurationSeconds).toBe(0);
    });

    it("never reports a negative ecsDurationSeconds", async () => {
      const runner = await preparedRunner();

      const result = await runner.reduce({
        env: makeConfig(),
        taskMetadata: makeMetadata({ startedAt: "2027-01-01T00:00:00Z" }),
        runResult: makeRunResult(),
      });

      expect(result.task.ecsDurationSeconds).toBe(0);
    });
  });
});
