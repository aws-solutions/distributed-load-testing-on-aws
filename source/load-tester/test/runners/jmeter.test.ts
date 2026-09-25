// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EcsTaskMetadata } from "../../src/ecs-metadata.js";
import type { RunnerConfig } from "../../src/env.js";
import { installJMeter } from "../../src/jmeter/install-jmeter.js";
import { stopJMeter } from "../../src/jmeter/shutdown.js";
import { tailJMeterKpiJtl } from "../../src/live-data/tail-kpi-jtl.js";
import type { Logger } from "../../src/logger.js";
import { superviseProcess } from "../../src/process/process-supervisor.js";
import { JMeterRunner } from "../../src/runners/jmeter.js";
import type { RunnerRunResult } from "../../src/runners/runner.js";

vi.mock("../../src/jmeter/install-jmeter.js", () => ({ installJMeter: vi.fn() }));
vi.mock("../../src/jmeter/shutdown.js", () => ({ stopJMeter: vi.fn() }));
vi.mock("../../src/live-data/tail-kpi-jtl.js", () => ({ tailJMeterKpiJtl: vi.fn() }));
vi.mock("../../src/process/process-supervisor.js", () => ({ superviseProcess: vi.fn() }));

const installMock = vi.mocked(installJMeter);
const stopMock = vi.mocked(stopJMeter);
const tailMock = vi.mocked(tailJMeterKpiJtl);
const superviseMock = vi.mocked(superviseProcess);

const JMETER_HOME = "/tmp/dlt-jmeter-abc/apache-jmeter-5.6.3";
const LAUNCHER = join(JMETER_HOME, "bin", "jmeter");
const HEADER =
  "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success," +
  "failureMessage,bytes,sentBytes,grpThreads,allThreads,URL,Latency,IdleTime,Connect";

let rootDir: string;
let artifactsDir: string;
let scriptPath: string;
let errorLogs: unknown[];

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    testId: "test-123",
    framework: "jmeter",
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
    artifacts: { kpiJtl: join(artifactsDir, "kpi.jtl"), jmeterLog: join(artifactsDir, "jmeter.log") },
    ...overrides,
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn((...args: unknown[]) => {
      errorLogs.push(args);
    }),
  } as unknown as Logger;
}

async function preparedRunner(config = makeConfig()): Promise<JMeterRunner> {
  const runner = new JMeterRunner(makeLogger());
  await runner.prepare({
    env: config,
    taskMetadata: makeMetadata(),
    s3Client: {} as S3Client,
    scenariosBucket: "scenarios-bucket",
  });
  return runner;
}

function runInput(config: RunnerConfig, abortSignal = new AbortController().signal) {
  return {
    env: config,
    taskMetadata: makeMetadata(),
    liveDataEmitter: { emit: vi.fn() },
    abortSignal,
  };
}

async function writeJtl(...lines: readonly string[]): Promise<void> {
  await writeFile(join(artifactsDir, "kpi.jtl"), `${[HEADER, ...lines].join("\n")}\n`);
}

describe("JMeterRunner", () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "dlt-jmeter-runner-"));
    artifactsDir = join(rootDir, "artifacts");
    scriptPath = join(rootDir, "scripts", "plan.jmx");
    await mkdir(dirname(scriptPath), { recursive: true });
    await mkdir(artifactsDir);
    await writeFile(scriptPath, "<jmeterTestPlan/>\n");
    errorLogs = [];

    installMock.mockReset();
    installMock.mockResolvedValue(JMETER_HOME);
    stopMock.mockReset();
    stopMock.mockResolvedValue(undefined);
    superviseMock.mockReset();
    superviseMock.mockResolvedValue({ exitCode: 0, signal: null, stopReason: "natural", stderrTail: "" });
    tailMock.mockReset();
    tailMock.mockImplementation(async (input) => {
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
      return { parsedRowCount: 0, unreadableRowCount: 0, lateRowCount: 0, parseErrorCount: 0 };
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("installs JMeter during prepare, from the scenarios bucket", async () => {
    const runner = await preparedRunner();

    expect(runner.name).toBe("jmeter");
    expect(installMock).toHaveBeenCalledWith({
      s3: {},
      bucket: "scenarios-bucket",
      temporaryDirectory: tmpdir(),
    });
  });

  it("refuses to run before prepare has installed the runtime", async () => {
    const runner = new JMeterRunner(makeLogger());

    await expect(runner.run(runInput(makeConfig()))).rejects.toThrow("prepare() must complete before run()");
  });

  it("runs the plan from the script directory and tails before spawn", async () => {
    const config = makeConfig();
    const runner = await preparedRunner(config);
    const abortSignal = new AbortController().signal;

    const result = await runner.run(runInput(config, abortSignal));

    expect(tailMock.mock.invocationCallOrder[0]).toBeLessThan(superviseMock.mock.invocationCallOrder[0] ?? 0);
    const call = superviseMock.mock.calls[0]?.[0];
    expect(call?.command).toBe(LAUNCHER);
    expect(call?.cwd).toBe(dirname(scriptPath));
    expect(call?.abortSignal).toBe(abortSignal);
    expect(call?.gracePeriodMs).toBe(12_000);
    expect(call?.args.slice(0, 7)).toEqual([
      "-n",
      "-t",
      scriptPath,
      "-l",
      join(artifactsDir, "kpi.jtl"),
      "-j",
      join(artifactsDir, "jmeter.log"),
    ]);
    expect(result.artifacts).toEqual({
      kpiJtl: join(artifactsDir, "kpi.jtl"),
      jmeterLog: join(artifactsDir, "jmeter.log"),
    });
  });

  // JVM_ARGS is set on the hub task definition and merged into every native task.
  // spawn() inherits the environment only when env is undefined, so passing an
  // explicit object here would silently drop the customer's heap settings.
  it("passes no env, so the task's JVM_ARGS reaches the JVM", async () => {
    const config = makeConfig();
    const runner = await preparedRunner(config);

    await runner.run(runInput(config));

    expect(superviseMock.mock.calls[0]?.[0]).not.toHaveProperty("env");
  });

  it("passes no load properties — the plan is the sole authority on load", async () => {
    const config = makeConfig();
    const runner = await preparedRunner(config);

    await runner.run(runInput(config));

    const args = superviseMock.mock.calls[0]?.[0].args ?? [];
    expect(args.filter((arg) => /threads|concurrency|ramp|duration|hold/i.test(arg))).toEqual([]);
  });

  it("skips tailing when live data is switched off", async () => {
    const config = makeConfig({ liveDataEnabled: false });
    const runner = await preparedRunner(config);

    await runner.run(runInput(config));

    expect(tailMock).not.toHaveBeenCalled();
    expect(superviseMock).toHaveBeenCalledOnce();
  });

  it("keeps running when the tailer fails", async () => {
    tailMock.mockRejectedValue(new Error("EIO"));
    const config = makeConfig();
    const runner = await preparedRunner(config);

    const result = await runner.run(runInput(config));

    expect(result.exitCode).toBe(0);
    expect(errorLogs).toHaveLength(1);
  });

  describe("abort", () => {
    it("asks JMeter to stop so it finalizes the JTL", async () => {
      const config = makeConfig();
      const runner = await preparedRunner(config);

      await runner.run(runInput(config));
      const onAbort = superviseMock.mock.calls[0]?.[0].onAbort;
      expect(onAbort).toBeTypeOf("function");
      await onAbort?.();

      expect(stopMock).toHaveBeenCalledWith({ jmeterHome: JMETER_HOME });
    });

    // superviseProcess discards anything onAbort throws and, because an onAbort was
    // supplied, sends no signal of its own — so the failure has to be logged here
    // and the grace-period SIGKILL is the backstop.
    it("logs a failed stop instead of throwing", async () => {
      stopMock.mockRejectedValue(new Error("connection refused"));
      const config = makeConfig();
      const runner = await preparedRunner(config);

      await runner.run(runInput(config));
      const onAbort = superviseMock.mock.calls[0]?.[0].onAbort;

      await expect(onAbort?.()).resolves.toBeUndefined();
      expect(errorLogs).toHaveLength(1);
    });

    // Measured: JMeter exits 0 after stoptest.sh, so an aborted run looks exactly
    // like a clean one from the exit code alone. Nothing may infer failure from it.
    it("reports the exit code JMeter gave, even after being stopped", async () => {
      superviseMock.mockResolvedValue({ exitCode: 0, signal: null, stopReason: "aborted", stderrTail: "" });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      const result = await runner.run(runInput(config));

      expect(result.exitCode).toBe(0);
    });
  });

  describe("exit codes", () => {
    it.each([0, 1, 2])("preserves exit code %i for reduction", async (exitCode) => {
      superviseMock.mockResolvedValue({ exitCode, signal: null, stopReason: "natural", stderrTail: "" });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      const result = await runner.run(runInput(config));
      expect(result.exitCode).toBe(exitCode);
      expect(result.stopReason).toBe("natural");
    });

    it("reports a killed process as 128 plus the signal number", async () => {
      superviseMock.mockResolvedValue({ exitCode: null, signal: "SIGKILL", stopReason: "killed", stderrTail: "" });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      const result = await runner.run(runInput(config));
      expect(result.exitCode).toBe(137);
      expect(result.stopReason).toBe("killed");
    });

    it("fails loudly when JMeter could not be spawned at all", async () => {
      superviseMock.mockResolvedValue({ exitCode: null, signal: null, stopReason: "natural", stderrTail: "" });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      await expect(runner.run(runInput(config))).rejects.toThrow(`Failed to spawn JMeter at "${LAUNCHER}"`);
    });

    it("returns the final jmeter.log ERROR record for a non-zero exit", async () => {
      await writeFile(
        join(artifactsDir, "jmeter.log"),
        [
          "2026-09-09 15:40:40,100 INFO o.a.j.s.SaveService: Loading file",
          "2026-09-09 15:40:40,118 ERROR o.a.j.JMeter: Error in NonGUIDriver",
          "java.lang.IllegalArgumentException: Problem loading XML",
          "2026-09-09 15:40:40,127 ERROR o.a.j.JMeter: An error occurred:",
          "org.apache.jmeter.report.config.ConfigurationException: Error in NonGUIDriver",
          "Cause:",
          "EOFException: no more data available",
          "2026-09-09 15:40:40,130 INFO o.a.j.JMeter: shutdown complete",
        ].join("\n")
      );
      superviseMock.mockResolvedValue({
        exitCode: 1,
        signal: null,
        stopReason: "natural",
        stderrTail: "launcher warning",
      });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      expect((await runner.run(runInput(config))).stderrTail).toBe(
        [
          "2026-09-09 15:40:40,127 ERROR o.a.j.JMeter: An error occurred:",
          "org.apache.jmeter.report.config.ConfigurationException: Error in NonGUIDriver",
          "Cause:",
          "EOFException: no more data available",
        ].join("\n")
      );
    });

    it("falls back to stderr when jmeter.log has no ERROR record", async () => {
      await writeFile(
        join(artifactsDir, "jmeter.log"),
        "2026-09-09 15:40:40,100 INFO o.a.j.JMeter: startup complete\n"
      );
      superviseMock.mockResolvedValue({
        exitCode: 1,
        signal: null,
        stopReason: "natural",
        stderrTail: "JVM startup failed",
      });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      expect((await runner.run(runInput(config))).stderrTail).toBe("JVM startup failed");
    });

    it("falls back to stderr when jmeter.log is missing", async () => {
      superviseMock.mockResolvedValue({
        exitCode: 1,
        signal: null,
        stopReason: "natural",
        stderrTail: "JMeter launcher failed",
      });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      expect((await runner.run(runInput(config))).stderrTail).toBe("JMeter launcher failed");
    });

    it("does not substitute jmeter.log diagnostics for a successful exit", async () => {
      await writeFile(
        join(artifactsDir, "jmeter.log"),
        "2026-09-09 15:40:40,118 ERROR o.a.j.JMeter: non-fatal logging problem\n"
      );
      superviseMock.mockResolvedValue({
        exitCode: 0,
        signal: null,
        stopReason: "natural",
        stderrTail: "launcher warning",
      });
      const config = makeConfig();
      const runner = await preparedRunner(config);

      expect((await runner.run(runInput(config))).stderrTail).toBe("launcher warning");
    });
  });

  describe("reduce", () => {
    it("aggregates the JTL into a dlt.result.v1 result", async () => {
      await writeJtl(
        "1787014652524,100,Sleep,200,OK,TG 1-1,text,true,,2,0,2,2,null,10,0,5",
        "1787014652624,300,Sleep,500,KO,TG 1-1,text,false,,2,0,2,3,null,20,0,7"
      );
      const config = makeConfig();
      const runner = await preparedRunner(config);

      const result = await runner.reduce({
        env: config,
        taskMetadata: makeMetadata(),
        runResult: makeRunResult(),
      });

      expect(result.schema).toBe("dlt.result.v1");
      expect(result.summary).toMatchObject({
        totalRequestCount: 2,
        failureCount: 1,
        concurrency: 3,
        averageResponseTimeMilliseconds: 200,
      });
      expect(result.labels.map((label) => label.label)).toEqual(["Sleep"]);
      expect(result.task.ecsDurationSeconds).toBe(120);
      expect(result.statistics.summary).toMatchObject({
        requests: { total: 2, success: 1, failure: 1 },
        waitingTime: { count: 2, meanUs: 15_000 },
        connectTime: { count: 2, meanUs: 6_000 },
      });
      expect(result).toEqual(
        JSON.parse(await readFile(new URL("../fixtures/jmeter-result.json", import.meta.url), "utf8"))
      );
    });

    it("keeps JMeter's text response codes in the breakdown", async () => {
      await writeJtl(
        '1787014652524,20,/api,"Non HTTP response code: java.net.ConnectException",' +
          '"Non HTTP response message: Connection refused",TG 1-1,text,false,,0,0,1,1,null,0,0,0'
      );
      const config = makeConfig();
      const runner = await preparedRunner(config);

      const result = await runner.reduce({ env: config, taskMetadata: makeMetadata(), runResult: makeRunResult() });

      expect(result.summary.responseCodes).toEqual([
        { code: "Non HTTP response code: java.net.ConnectException", count: 1 },
      ]);
    });

    // Skipping the result would skip the completion marker written after it, which
    // hangs the whole test in every region.
    it("returns an empty result rather than throwing when the JTL is missing", async () => {
      const config = makeConfig();
      const runner = await preparedRunner(config);

      const result = await runner.reduce({ env: config, taskMetadata: makeMetadata(), runResult: makeRunResult() });

      expect(result.summary.totalRequestCount).toBe(0);
      expect(result.labels).toEqual([]);
      expect(errorLogs).toHaveLength(1);
    });

    it("reduces the rows it could read from a JTL cut short", async () => {
      await writeJtl("1787014652524,100,Sleep,200,OK,TG 1-1,text,true,,2,0,2,2,null,0,0,0", "1787014652624,50,Sle");
      const config = makeConfig();
      const runner = await preparedRunner(config);

      const result = await runner.reduce({ env: config, taskMetadata: makeMetadata(), runResult: makeRunResult() });

      expect(result.summary.totalRequestCount).toBe(2);
    });
  });
});
