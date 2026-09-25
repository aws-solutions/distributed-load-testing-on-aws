// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import fs from "node:fs";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DltResultV1 } from "@amzn/dlt-common";
import { finalizeResultState, ResultAccumulator } from "@amzn/dlt-common/streaming-statistics";
import type { EcsTaskMetadata } from "../../src/ecs-metadata.js";
import type { ContainerConfig } from "../../src/env.js";
import { runLifecycle } from "../../src/lifecycle/run.js";
import type { LiveDataEmitter } from "../../src/live-data/emitter.js";
import type { FrameworkRunner, RunnerRunResult } from "../../src/runners/runner.js";

const MAX_DURATION_SECONDS = 86_400;

vi.mock("../../src/s3/download-to-file.js", () => ({
  downloadToFile: vi.fn().mockResolvedValue(undefined),
}));

const s3Mock = mockClient(S3Client);

function makeEnv(overrides: Partial<ContainerConfig> = {}): ContainerConfig {
  return {
    s3Bucket: "test-bucket",
    testId: "test-123",
    testRunId: "run-456",
    testType: "jmeter",
    fileType: "script",
    prefix: "20260514_run-456",
    liveDataEnabled: false,
    mainStackRegion: "us-east-1",
    awsRegion: "us-east-1",
    ecsMetadataUri: "http://169.254.170.2/v4",
    maxDurationSeconds: MAX_DURATION_SECONDS,
    ...overrides,
  };
}

function makeMetadata(): EcsTaskMetadata {
  return {
    taskArn: "arn:aws:ecs:us-east-1:123456789:task/cluster/abc123",
    taskId: "abc123",
    taskCpu: 2,
    taskMemory: 4096,
    startedAt: "2026-05-14T10:00:00Z",
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as never;
}

function makeEmitter(): LiveDataEmitter {
  return { emit: vi.fn() };
}

const FAKE_STATISTICS = new ResultAccumulator().snapshot();
const FAKE_RESULT: DltResultV1 = {
  schema: "dlt.result.v1",
  testId: "test-123",
  taskId: "abc123",
  region: "us-east-1",
  startTime: "2026-05-14T10:00:00Z",
  endTime: "2026-05-14T10:01:00Z",
  testDurationSeconds: 60,
  task: { vcpus: 2, memoryMiB: 4096, ecsDurationSeconds: 60 },
  ...finalizeResultState(FAKE_STATISTICS, { summaryConcurrency: 0 }),
  statistics: FAKE_STATISTICS,
};

function makeRunner(
  overrides: {
    runBehavior?: (input: unknown) => Promise<RunnerRunResult>;
    reduceBehavior?: (input: unknown) => Promise<DltResultV1>;
  } = {}
): FrameworkRunner & {
  prepareCalls: unknown[];
  runCalls: unknown[];
  reduceCalls: unknown[];
} {
  const prepareCalls: unknown[] = [];
  const runCalls: unknown[] = [];
  const reduceCalls: unknown[] = [];

  const defaultRunResult: RunnerRunResult = {
    exitCode: 0,
    stderrTail: "",
    stopReason: "natural",
    startedAt: new Date("2026-05-14T10:00:00Z"),
    endedAt: new Date("2026-05-14T10:01:00Z"),
    artifacts: {},
  };

  const runBehavior = overrides.runBehavior ?? (() => Promise.resolve(defaultRunResult));

  return {
    name: "jmeter",
    prepareCalls,
    runCalls,
    reduceCalls,
    prepare(input) {
      prepareCalls.push(input);
      return Promise.resolve();
    },
    run(input) {
      runCalls.push(input);
      return runBehavior(input);
    },
    reduce(input) {
      reduceCalls.push(input);
      return overrides.reduceBehavior?.(input) ?? Promise.resolve(FAKE_RESULT);
    },
  };
}

async function runAndDrain(input: Parameters<typeof runLifecycle>[0]): Promise<void> {
  void runLifecycle(input);
  await vi.waitFor(() => {
    const completionCall = s3Mock
      .commandCalls(PutObjectCommand)
      .find((call) => call.args[0].input.Key?.includes("/completion/"));
    expect(completionCall).toBeDefined();
  });
  // The S3 mock records the command before its promise resumes the lifecycle.
  // Yield once so the signal manager reaches idle before we send SIGTERM.
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.emit("SIGTERM");
  await new Promise((r) => setTimeout(r, 10));
}

describe("runLifecycle", () => {
  let exitSpy: MockInstance;

  beforeEach(async () => {
    s3Mock.reset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    s3Mock.on(HeadObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});
    await Promise.all([
      fs.promises.rm("/tmp/work", { recursive: true, force: true }),
      fs.promises.rm("/tmp/artifacts", { recursive: true, force: true }),
    ]);
    // downloadToFile is mocked (no real S3 download), so create the file
    // the lifecycle expects to find after "downloading" the script.
    await fs.promises.mkdir("/tmp/work", { recursive: true });
    await fs.promises.writeFile("/tmp/work/test-123.jmx", "<TestPlan/>");
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe("happy path", () => {
    it("calls prepare → run → reduce in sequence", async () => {
      const runner = makeRunner();
      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      expect(runner.prepareCalls).toHaveLength(1);
      expect(runner.runCalls).toHaveLength(1);
      expect(runner.reduceCalls).toHaveLength(1);
    });

    it("writes a completion marker to S3", async () => {
      const runner = makeRunner();
      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      const completionCall = putCalls.find((c) => c.args[0].input.Key?.includes("/completion/"));
      expect(completionCall).toBeDefined();
      expect(completionCall?.args[0].input.Key).toBe("results/test-123/20260514_run-456/completion/us-east-1/abc123");

      const putKeys = putCalls.map((call) => call.args[0].input.Key);
      expect(putKeys.indexOf("results/test-123/20260514_run-456/us-east-1/abc123/result.json")).toBeLessThan(
        putKeys.indexOf("results/test-123/20260514_run-456/completion/us-east-1/abc123")
      );
    });

    it("uploads generated artifacts without copying the downloaded script", async () => {
      await fs.promises.mkdir("/tmp/artifacts", { recursive: true });
      await fs.promises.writeFile("/tmp/artifacts/kpi.jtl", "timeStamp,elapsed\n");

      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner: makeRunner(),
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      const putKeys = s3Mock.commandCalls(PutObjectCommand).map((call) => call.args[0].input.Key);
      expect(putKeys).toEqual([
        "results/test-123/20260514_run-456/us-east-1/abc123/result.json",
        "results/test-123/20260514_run-456/us-east-1/abc123/kpi.jtl",
        "results/test-123/20260514_run-456/completion/us-east-1/abc123",
      ]);
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/us-east-1/abc123/test-123.jmx");
    });

    it("builds a runner config with no load overrides — the script controls its own load", async () => {
      const runner = makeRunner();
      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      expect(runner.runCalls[0]).toHaveProperty("env");
      expect((runner.runCalls[0] as { env: object }).env).not.toHaveProperty("loadOverrides");
    });

    it("still writes completion when a result upload fails", async () => {
      s3Mock
        .on(PutObjectCommand, {
          Bucket: "test-bucket",
          Key: "results/test-123/20260514_run-456/us-east-1/abc123/result.json",
        })
        .rejects(new Error("S3 unavailable"));

      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner: makeRunner(),
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      expect(
        s3Mock
          .commandCalls(PutObjectCommand)
          .some((call) => call.args[0].input.Key === "results/test-123/20260514_run-456/completion/us-east-1/abc123")
      ).toBe(true);
    });

    it("exits 0 when SIGTERM arrives in the idle phase", async () => {
      const runner = makeRunner();
      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("SIGTERM during running", () => {
    it("aborts the runner, uploads available artifacts, and exits cleanly after finalizing", async () => {
      const runner = makeRunner({
        runBehavior: async (input) => {
          const { abortSignal } = input as { abortSignal: AbortSignal };
          await new Promise<void>((resolve) => {
            if (abortSignal.aborted) {
              resolve();
              return;
            }
            abortSignal.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true }
            );
          });
          return {
            exitCode: 137,
            stderrTail: "terminated",
            stopReason: "killed",
            startedAt: new Date("2026-05-14T10:00:00Z"),
            endedAt: new Date(),
            artifacts: {},
          };
        },
      });

      const lifecycle = runLifecycle({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      await new Promise((r) => setTimeout(r, 50));
      process.emit("SIGTERM");
      await lifecycle;

      expect(runner.reduceCalls).toHaveLength(1);
      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      const putKeys = putCalls.map((call) => call.args[0].input.Key);
      expect(putKeys).toContain("results/test-123/20260514_run-456/us-east-1/abc123/result.json");
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/us-east-1/abc123/framework-exit.json");
      expect(putKeys).toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123");
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123.warning");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("SIGTERM during finalizing", () => {
    it("finishes the upload and exits without waiting for another signal", async () => {
      let reductionStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        reductionStarted = resolve;
      });
      let finishReduction: (() => void) | undefined;
      const finish = new Promise<void>((resolve) => {
        finishReduction = resolve;
      });
      const runner = makeRunner({
        reduceBehavior: async () => {
          reductionStarted?.();
          await finish;
          return FAKE_RESULT;
        },
      });

      const lifecycle = runLifecycle({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      await started;
      process.emit("SIGTERM");
      finishReduction?.();
      await lifecycle;

      const putKeys = s3Mock.commandCalls(PutObjectCommand).map((call) => call.args[0].input.Key);
      expect(putKeys).toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("maximum test duration", () => {
    it("uploads partial results without recording a natural framework exit", async () => {
      let runnerStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        runnerStarted = resolve;
      });
      let capturedSignal: AbortSignal | undefined;
      const error = vi.fn();
      const logger = { info: vi.fn(), warn: vi.fn(), error, child: vi.fn().mockReturnThis() } as never;
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const runner = makeRunner({
        runBehavior: async (input) => {
          const { abortSignal } = input as { abortSignal: AbortSignal };
          capturedSignal = abortSignal;
          runnerStarted?.();
          await new Promise<void>((resolve) => {
            abortSignal.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true }
            );
          });
          return {
            exitCode: 137,
            stderrTail: "maximum duration reached",
            stopReason: "killed",
            startedAt: new Date("2026-05-14T10:00:00Z"),
            endedAt: new Date(),
            artifacts: {},
          };
        },
      });

      const lifecycle = runLifecycle({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger,
      });

      await started;
      const maxDurationCall = setTimeoutSpy.mock.calls.find(([, delay]) => delay === MAX_DURATION_SECONDS * 1000);
      expect(maxDurationCall).toBeDefined();

      const onMaxDuration = maxDurationCall?.[0] as (() => void) | undefined;
      onMaxDuration?.();
      await vi.waitFor(() => {
        expect(
          s3Mock.commandCalls(PutObjectCommand).some((call) => call.args[0].input.Key?.includes("/completion/"))
        ).toBe(true);
      });

      expect(capturedSignal?.aborted).toBe(true);
      expect(error).toHaveBeenCalledWith(
        { maxDurationSeconds: MAX_DURATION_SECONDS },
        "maximum test duration reached - aborting load test"
      );
      expect(runner.reduceCalls).toHaveLength(1);
      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      const putKeys = putCalls.map((call) => call.args[0].input.Key);
      expect(putKeys).toContain("results/test-123/20260514_run-456/us-east-1/abc123/result.json");
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/us-east-1/abc123/framework-exit.json");
      expect(putKeys).toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123");
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123.warning");

      process.emit("SIGTERM");
      void lifecycle;
      setTimeoutSpy.mockRestore();
    });

    it("clears the maximum-duration timer after a normal run", async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner: makeRunner(),
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      const maxDurationCallIndex = setTimeoutSpy.mock.calls.findIndex(
        ([, delay]) => delay === MAX_DURATION_SECONDS * 1000
      );
      const maxDurationTimer = setTimeoutSpy.mock.results[maxDurationCallIndex]?.value as NodeJS.Timeout | undefined;
      expect(maxDurationTimer).toBeDefined();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(maxDurationTimer);

      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe("error cases", () => {
    it("uploads a sanitized framework-exit artifact and completes on a natural non-zero exit", async () => {
      const runner = makeRunner({
        runBehavior: () =>
          Promise.resolve({
            exitCode: 2,
            stderrTail: "\u001B[31mSyntaxError: bad script\u001B[0m\npassword=secret",
            stopReason: "natural",
            startedAt: new Date("2026-05-14T10:00:00Z"),
            endedAt: new Date("2026-05-14T10:00:01Z"),
            artifacts: {},
          }),
      });

      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      const frameworkExit: unknown = JSON.parse(
        await fs.promises.readFile("/tmp/artifacts/framework-exit.json", "utf8")
      );
      expect(frameworkExit).toEqual({
        schema: "dlt.framework-exit.v1",
        timestamp: "2026-05-14T10:00:01.000Z",
        testId: "test-123",
        testRunId: "run-456",
        taskId: "abc123",
        region: "us-east-1",
        framework: "jmeter",
        exitCode: 2,
        message: "SyntaxError: bad script <redacted>",
        stopReason: "natural",
      });
      const putKeys = s3Mock.commandCalls(PutObjectCommand).map((call) => call.args[0].input.Key);
      expect(putKeys.indexOf("results/test-123/20260514_run-456/us-east-1/abc123/framework-exit.json")).toBeLessThan(
        putKeys.indexOf("results/test-123/20260514_run-456/us-east-1/abc123/result.json")
      );
      expect(putKeys).toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123.warning");
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123");
    });

    it("still completes a natural non-zero exit when reduction has no results", async () => {
      const runner = makeRunner({
        runBehavior: () =>
          Promise.resolve({
            exitCode: 1,
            stderrTail: "script parse failed",
            stopReason: "natural",
            startedAt: new Date("2026-05-14T10:00:00Z"),
            endedAt: new Date("2026-05-14T10:00:01Z"),
            artifacts: {},
          }),
        reduceBehavior: () => Promise.reject(new Error("result file missing")),
      });

      await runAndDrain({
        env: makeEnv(),
        taskMetadata: makeMetadata(),
        runner,
        liveDataEmitter: makeEmitter(),
        logger: makeLogger(),
      });

      const putKeys = s3Mock.commandCalls(PutObjectCommand).map((call) => call.args[0].input.Key);
      expect(putKeys).toContain("results/test-123/20260514_run-456/us-east-1/abc123/framework-exit.json");
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/us-east-1/abc123/result.json");
      expect(putKeys).toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123.warning");
      expect(putKeys).not.toContain("results/test-123/20260514_run-456/completion/us-east-1/abc123");
    });

    it("keeps reducer failures fatal after a successful framework exit", async () => {
      const runner = makeRunner({
        reduceBehavior: () => Promise.reject(new Error("result file missing")),
      });

      await expect(
        runLifecycle({
          env: makeEnv(),
          taskMetadata: makeMetadata(),
          runner,
          liveDataEmitter: makeEmitter(),
          logger: makeLogger(),
        })
      ).rejects.toThrow("result file missing");

      const putKeys = s3Mock.commandCalls(PutObjectCommand).map((call) => call.args[0].input.Key);
      expect(putKeys.some((key) => key?.includes("/completion/"))).toBe(false);
    });

    it("fails without completion when the framework-exit artifact cannot be written", async () => {
      const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
      const writeFileSpy = vi.spyOn(fs.promises, "writeFile").mockImplementation(async (file, data, options) => {
        if (typeof file === "string" && file.endsWith("/framework-exit.json")) {
          throw new Error("disk full");
        }
        return originalWriteFile(file, data, options);
      });
      const runner = makeRunner({
        runBehavior: () =>
          Promise.resolve({
            exitCode: 1,
            stderrTail: "script parse failed",
            stopReason: "natural",
            startedAt: new Date("2026-05-14T10:00:00Z"),
            endedAt: new Date("2026-05-14T10:00:01Z"),
            artifacts: {},
          }),
      });

      await expect(
        runLifecycle({
          env: makeEnv(),
          taskMetadata: makeMetadata(),
          runner,
          liveDataEmitter: makeEmitter(),
          logger: makeLogger(),
        })
      ).rejects.toThrow("disk full");

      expect(
        s3Mock.commandCalls(PutObjectCommand).some((call) => call.args[0].input.Key?.includes("/completion/"))
      ).toBe(false);
      writeFileSpy.mockRestore();
    });

    it("propagates runner.run() errors", async () => {
      const runner = makeRunner({
        runBehavior: () => Promise.reject(new Error("Failed to spawn")),
      });

      await expect(
        runLifecycle({
          env: makeEnv(),
          taskMetadata: makeMetadata(),
          runner,
          liveDataEmitter: makeEmitter(),
          logger: makeLogger(),
        })
      ).rejects.toThrow("Failed to spawn");
    });

    it("throws on fileType=none", async () => {
      const runner = makeRunner();
      await expect(
        runLifecycle({
          env: makeEnv({ fileType: "none" }),
          taskMetadata: makeMetadata(),
          runner,
          liveDataEmitter: makeEmitter(),
          logger: makeLogger(),
        })
      ).rejects.toThrow("fileType=none is not supported");
    });
  });
});
