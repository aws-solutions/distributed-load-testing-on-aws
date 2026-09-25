// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Runs a load test with Locust.
//
// Locust itself writes no per-request data and no live metrics, so a Python
// sidecar baked into the container image does both: it appends every request to
// kpi.csv and prints one JSON line per second to stdout. The sidecar is
// configured entirely through the DLT_* environment variables set below.

import fs from "node:fs";
import path from "node:path";

import { LogEvent, type DltResultV1 } from "@amzn/dlt-common";

import { ecsDurationSeconds } from "../ecs-metadata.js";
import { installLocustDependencies } from "../locust/install-dependencies.js";
import { buildLocustArgs, STOP_TIMEOUT_SECONDS } from "../locust/locust-args.js";
import type { Logger } from "../logger.js";
import { superviseProcess } from "../process/process-supervisor.js";
import { parseLocustKpiCsv } from "../results/locust-reducer.js";
import { reduceKpiRows } from "../results/reduce-kpi-rows.js";
import type {
  FrameworkRunner,
  RunnerPrepareInput,
  RunnerReduceInput,
  RunnerRunInput,
  RunnerRunResult,
} from "./runner.js";
import { signalExitCode } from "./exit-code.js";

/** Where the container image puts the sidecar. Set by the Dockerfile. */
const SIDECAR_PATH = "/opt/dlt/sidecar.py";

/**
 * Where custom Python dependencies get installed, as a subdirectory of the
 * extracted archive. The leading dot means unzip would have stripped a directory
 * of this name from the user's zip, so it cannot collide with their content.
 */
const DEPENDENCIES_DIR_NAME = ".dlt-dependencies";

/**
 * How long to wait for Locust to exit after we signal it. The full shutdown
 * chain, from the moment ECS decides to stop the task:
 *
 *   t=0s          ECS sends SIGTERM to the container and starts its 120s
 *                 stopTimeout.
 *     ├─ 0-10s    Locust drains in-flight requests (--stop-timeout, which is
 *     │           STOP_TIMEOUT_SECONDS), then exits.
 *     ├─ 12s      GRACE_PERIOD_MS expires. If Locust is somehow still running we
 *     │           SIGKILL it and continue with whatever kpi.csv holds.
 *     └─ 12-120s  Node reduces kpi.csv and uploads the result to S3.
 *   t=120s        ECS sends SIGKILL to the container regardless.
 *
 * So the two knobs split cleanly: STOP_TIMEOUT_SECONDS is how long *Locust*
 * drains, GRACE_PERIOD_MS is how long *we* wait for Locust before giving up.
 * The +2s is slack for process teardown; everything it doesn't consume is left
 * for reduce-and-upload.
 */
const GRACE_PERIOD_MS = (STOP_TIMEOUT_SECONDS + 2) * 1000;

export class LocustRunner implements FrameworkRunner {
  readonly name = "locust" as const;

  private scriptDir = "";
  private kpiCsvPath = "";
  /** Set only when the archive declared dependencies to install. */
  private dependenciesDir: string | undefined;

  constructor(private readonly logger: Logger) {}

  async prepare(input: RunnerPrepareInput): Promise<void> {
    // Run from the script's own directory so relative imports and data files in
    // the user's zip resolve.
    this.scriptDir = path.dirname(input.env.testScriptPath);
    this.kpiCsvPath = path.join(input.env.artifactsDir, "kpi.csv");

    try {
      this.dependenciesDir = await installLocustDependencies({
        scriptDir: this.scriptDir,
        targetDir: path.join(this.scriptDir, DEPENDENCIES_DIR_NAME),
        logger: this.logger,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error({ err, error, logEvent: LogEvent.TASK_FAILED }, "custom Python dependency installation failed");
      throw err;
    }
  }

  async run(input: RunnerRunInput): Promise<RunnerRunResult> {
    const { env, abortSignal } = input;

    const args = buildLocustArgs({
      scriptPath: env.testScriptPath,
      artifactsDir: env.artifactsDir,
      sidecarPath: SIDECAR_PATH,
    });

    const startedAt = new Date();

    const result = await superviseProcess({
      command: "locust",
      args,
      cwd: this.scriptDir,
      env: {
        ...process.env,
        // Scoped to this process on purpose. PYTHONPATH takes precedence over the
        // image's site-packages, so exporting it process-wide would put user code
        // ahead of anything else the container runs.
        ...(this.dependenciesDir === undefined ? {} : { PYTHONPATH: this.pythonPathEnv(this.dependenciesDir) }),
        DLT_OUTPUT_DIR: env.artifactsDir,
        DLT_TEST_ID: env.testId,
        DLT_LIVE_DATA_ENABLED: String(env.liveDataEnabled),
      },
      abortSignal,
      gracePeriodMs: GRACE_PERIOD_MS,
    });

    // The supervisor reports both fields null only when the process could not be
    // spawned at all — a missing binary, not a test failure.
    if (result.exitCode === null && result.signal === null) {
      throw new Error("Failed to spawn locust — is it installed in the container image?");
    }

    return {
      // A null exit code means a signal killed it. Report the shell convention,
      // 128 + signal number, so the logged code says which signal.
      exitCode: result.exitCode ?? signalExitCode(result.signal),
      stderrTail: result.stderrTail,
      stopReason: result.stopReason,
      startedAt,
      endedAt: new Date(),
      artifacts: { kpiCsv: this.kpiCsvPath },
    };
  }

  /** Prepends the install directory to any PYTHONPATH the container already set. */
  private pythonPathEnv(dependenciesDir: string): string {
    const existing = process.env["PYTHONPATH"];
    return existing === undefined || existing === ""
      ? dependenciesDir
      : `${dependenciesDir}${path.delimiter}${existing}`;
  }

  /**
   * Artifact read failures produce partial results instead of throwing. The
   * completion marker written after this is what tells DLT the task finished,
   * and skipping it hangs the whole test in every region.
   */
  async reduce(input: RunnerReduceInput): Promise<DltResultV1> {
    const { env, taskMetadata, runResult } = input;

    const context = {
      testId: env.testId,
      taskId: taskMetadata.taskId,
      region: env.awsRegion,
      startedAt: runResult.startedAt,
      endedAt: runResult.endedAt,
      task: {
        vcpus: taskMetadata.taskCpu,
        memoryMiB: taskMetadata.taskMemory,
        // Measured from container start, not test start, so it includes script
        // download and the wait for the start signal. This is what the
        // ECSCalculatedDuration metric has always meant.
        ecsDurationSeconds: ecsDurationSeconds(taskMetadata, runResult.endedAt),
      },
    };

    return reduceKpiRows(parseLocustKpiCsv(fs.createReadStream(this.kpiCsvPath)), context);
  }
}
