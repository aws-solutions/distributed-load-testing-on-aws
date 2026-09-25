// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { LogEvent } from "@amzn/dlt-common";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EcsTaskMetadata } from "../../src/ecs-metadata.js";
import type { RunnerConfig } from "../../src/env.js";
import { installK6 } from "../../src/k6/install-k6.js";
import { tailK6KpiJson } from "../../src/live-data/tail-kpi-json.js";
import type { Logger } from "../../src/logger.js";
import { superviseProcess } from "../../src/process/process-supervisor.js";
import { K6Runner } from "../../src/runners/k6.js";
import type { RunnerRunResult } from "../../src/runners/runner.js";

vi.mock("../../src/k6/install-k6.js", () => ({
  installK6: vi.fn(),
}));
vi.mock("../../src/live-data/tail-kpi-json.js", () => ({
  tailK6KpiJson: vi.fn(),
}));
vi.mock("../../src/process/process-supervisor.js", () => ({
  superviseProcess: vi.fn(),
}));

const installMock = vi.mocked(installK6);
const tailMock = vi.mocked(tailK6KpiJson);
const superviseMock = vi.mocked(superviseProcess);
const BINARY_PATH = "/tmp/dlt-k6/1.5.0/k6";

let rootDir: string;
let artifactsDir: string;
let scriptPath: string;
let tailerSignal: AbortSignal | undefined;

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    testId: "test-123",
    framework: "k6",
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
    artifacts: {
      kpiCsv: join(artifactsDir, "kpi.csv"),
      kpiJson: join(artifactsDir, "kpi.json"),
    },
    ...overrides,
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

async function preparedRunner(config = makeConfig()): Promise<K6Runner> {
  const runner = new K6Runner(makeLogger());
  // s3Client/scenariosBucket exist for runners that install their framework from
  // a bundle DLT ships (JMeter). k6 downloads from the internet and reads neither.
  await runner.prepare({
    env: config,
    taskMetadata: makeMetadata(),
    s3Client: {} as S3Client,
    scenariosBucket: "scenarios-bucket",
  });
  return runner;
}

function point(metric: string, value: number): string {
  return JSON.stringify({
    type: "Point",
    metric,
    data: {
      time: "2026-05-14T10:01:30Z",
      value,
      tags: { name: "/api", status: "200" },
    },
  });
}

describe("K6Runner", () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "dlt-k6-runner-"));
    artifactsDir = join(rootDir, "artifacts");
    scriptPath = join(rootDir, "scripts", "test.js");
    await mkdir(dirname(scriptPath), { recursive: true });
    await mkdir(artifactsDir);
    await writeFile(scriptPath, "export default function () {}\n");

    installMock.mockReset();
    installMock.mockResolvedValue(BINARY_PATH);
    superviseMock.mockReset();
    superviseMock.mockResolvedValue({ exitCode: 0, signal: null, stopReason: "natural", stderrTail: "" });
    tailerSignal = undefined;
    tailMock.mockReset();
    tailMock.mockImplementation(async (input) => {
      tailerSignal = input.signal;
      if (!input.signal.aborted) {
        await new Promise<void>((resolve) => {
          input.signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true }
          );
        });
      }
      return {
        parsedPointCount: 0,
        malformedLineCount: 0,
        unsupportedLineCount: 0,
      };
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("installs k6 during prepare", async () => {
    const runner = await preparedRunner();

    expect(runner.name).toBe("k6");
    expect(installMock).toHaveBeenCalledOnce();
  });

  it("logs a queryable task failure and rethrows when k6 installation fails", async () => {
    const failure = new Error(
      "Unable to download https://example.test/k6.tar.gz after 3 attempts: HTTP 503 Unavailable"
    );
    installMock.mockRejectedValueOnce(failure);
    const logger = makeLogger();
    const runner = new K6Runner(logger);

    await expect(
      runner.prepare({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        s3Client: {} as S3Client,
        scenariosBucket: "scenarios-bucket",
      })
    ).rejects.toBe(failure);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      {
        err: failure,
        error: failure.message,
        logEvent: LogEvent.TASK_FAILED,
      },
      "k6 runtime installation failed"
    );
  });

  it("runs the installed binary from the script directory and tails before spawn", async () => {
    const config = makeConfig();
    const runner = await preparedRunner(config);
    const abortSignal = new AbortController().signal;

    const result = await runner.run({
      env: config,
      taskMetadata: makeMetadata(),
      liveDataEmitter: { emit: vi.fn() },
      abortSignal,
    });

    expect(tailMock.mock.invocationCallOrder[0]).toBeLessThan(superviseMock.mock.invocationCallOrder[0] ?? 0);
    expect(superviseMock).toHaveBeenCalledWith({
      command: BINARY_PATH,
      args: [
        "run",
        "--no-usage-report",
        "--out",
        `csv=${join(artifactsDir, "kpi.csv")}`,
        "--out",
        `json=${join(artifactsDir, "kpi.json")}`,
        scriptPath,
      ],
      cwd: dirname(scriptPath),
      abortSignal,
      gracePeriodMs: 12_000,
    });
    expect(superviseMock.mock.calls[0]?.[0]).not.toHaveProperty("onAbort");
    expect(result.artifacts).toEqual({
      kpiCsv: join(artifactsDir, "kpi.csv"),
      kpiJson: join(artifactsDir, "kpi.json"),
    });
  });

  it.each([0, 99, 105])("preserves k6 exit code %i for reduction", async (exitCode) => {
    superviseMock.mockResolvedValue({ exitCode, signal: null, stopReason: "natural", stderrTail: "" });
    const runner = await preparedRunner();

    const result = await runner.run({
      env: makeConfig(),
      taskMetadata: makeMetadata(),
      liveDataEmitter: { emit: vi.fn() },
      abortSignal: new AbortController().signal,
    });

    expect(result.exitCode).toBe(exitCode);
    expect(result.stopReason).toBe("natural");
  });

  it.each([
    ["SIGTERM", 143],
    ["SIGKILL", 137],
  ] as const)("reports %s using the shell exit-code convention", async (signal, exitCode) => {
    superviseMock.mockResolvedValue({ exitCode: null, signal, stopReason: "killed", stderrTail: "" });
    const runner = await preparedRunner();

    const result = await runner.run({
      env: makeConfig(),
      taskMetadata: makeMetadata(),
      liveDataEmitter: { emit: vi.fn() },
      abortSignal: new AbortController().signal,
    });

    expect(result.exitCode).toBe(exitCode);
    expect(result.stopReason).toBe("killed");
  });

  it("stops the tailer and throws when k6 cannot spawn", async () => {
    superviseMock.mockResolvedValue({ exitCode: null, signal: null, stopReason: "natural", stderrTail: "" });
    const runner = await preparedRunner();

    await expect(
      runner.run({
        env: makeConfig(),
        taskMetadata: makeMetadata(),
        liveDataEmitter: { emit: vi.fn() },
        abortSignal: new AbortController().signal,
      })
    ).rejects.toThrow(`Failed to spawn k6 at "${BINARY_PATH}".`);
    expect(tailerSignal?.aborted).toBe(true);
  });

  it("reduces output after a non-zero exit and uses container-start ECS duration", async () => {
    await writeFile(
      join(artifactsDir, "kpi.json"),
      [
        point("http_reqs", 1),
        point("http_req_failed", 0),
        point("http_req_duration", 75),
        point("http_req_waiting", 60),
        point("http_req_connecting", 5),
        point("data_received", 100),
        point("vus", 1),
      ].join("\n")
    );
    const runner = await preparedRunner();

    const result = await runner.reduce({
      env: makeConfig(),
      taskMetadata: makeMetadata(),
      runResult: makeRunResult({ exitCode: 99 }),
    });

    expect(result.summary.totalRequestCount).toBe(1);
    expect(result.summary.averageResponseTimeMilliseconds).toBe(75);
    expect(result.testDurationSeconds).toBe(60);
    expect(result.task.ecsDurationSeconds).toBe(120);
    expect(result).toEqual(JSON.parse(await readFile(new URL("../fixtures/k6-result.json", import.meta.url), "utf8")));
  });
});
