// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Runs a load test with k6.
//
// k6 writes CSV for customer inspection and NDJSON for DLT live data and final
// results. The NDJSON tailer starts before k6 because the output file is created
// lazily, then receives its own abort only after k6 has stopped writing.

import path from "node:path";

import { LogEvent, type DltResultV1 } from "@amzn/dlt-common";

import { ecsDurationSeconds } from "../ecs-metadata.js";
import { installK6 } from "../k6/install-k6.js";
import { buildK6Args } from "../k6/k6-args.js";
import { K6LiveDataAggregator } from "../live-data/k6-aggregator.js";
import { tailK6KpiJson } from "../live-data/tail-kpi-json.js";
import type { Logger } from "../logger.js";
import { superviseProcess } from "../process/process-supervisor.js";
import { reduceK6KpiJson } from "../results/k6-reducer.js";
import type {
  FrameworkRunner,
  RunnerPrepareInput,
  RunnerReduceInput,
  RunnerRunInput,
  RunnerRunResult,
} from "./runner.js";
import { signalExitCode } from "./exit-code.js";

/**
 * k6 gets the same 12 seconds Locust gets to stop and flush its output. ECS
 * sends SIGKILL at 120 seconds, leaving the rest for final reduction and
 * uploads when k6 uses the whole grace period.
 */
const GRACE_PERIOD_MILLISECONDS = 12_000;

export class K6Runner implements FrameworkRunner {
  readonly name = "k6" as const;

  private binaryPath = "";
  private scriptDir = "";
  private kpiCsvPath = "";
  private kpiJsonPath = "";

  constructor(private readonly logger: Logger) {}

  async prepare(input: RunnerPrepareInput): Promise<void> {
    this.scriptDir = path.dirname(input.env.testScriptPath);
    this.kpiCsvPath = path.join(input.env.artifactsDir, "kpi.csv");
    this.kpiJsonPath = path.join(input.env.artifactsDir, "kpi.json");

    this.logger.info("installing k6 runtime");
    try {
      this.binaryPath = await installK6();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error({ err, error, logEvent: LogEvent.TASK_FAILED }, "k6 runtime installation failed");
      throw err;
    }
    this.logger.info({ binaryPath: this.binaryPath }, "k6 runtime installed");
  }

  async run(input: RunnerRunInput): Promise<RunnerRunResult> {
    if (this.binaryPath === "") {
      throw new Error("K6Runner.prepare() must complete before run().");
    }

    const args = buildK6Args({
      scriptPath: input.env.testScriptPath,
      csvOutputPath: this.kpiCsvPath,
      jsonOutputPath: this.kpiJsonPath,
    });

    const aggregator = new K6LiveDataAggregator(input.liveDataEmitter);
    const tailerAbort = new AbortController();
    const tailing = tailK6KpiJson({
      kpiJsonPath: this.kpiJsonPath,
      aggregator,
      signal: tailerAbort.signal,
    }).catch((err: unknown) => {
      // Live data is best-effort. Final reduction reads the same artifact and
      // must still run if incremental tailing encounters a file error.
      this.logger.error({ err }, "k6 live-data tailer failed");
      return undefined;
    });

    this.logger.info(
      {
        csvOutputPath: this.kpiCsvPath,
        jsonOutputPath: this.kpiJsonPath,
      },
      "starting k6"
    );

    const startedAt = new Date();
    let endedAt: Date;
    let processResult: Awaited<ReturnType<typeof superviseProcess>>;
    try {
      processResult = await superviseProcess({
        command: this.binaryPath,
        args,
        cwd: this.scriptDir,
        abortSignal: input.abortSignal,
        gracePeriodMs: GRACE_PERIOD_MILLISECONDS,
      });
      endedAt = new Date();
    } finally {
      // The lifecycle signal may have stopped k6, but the tailer stays alive
      // until the process exits so it can read everything k6 flushed on SIGTERM.
      tailerAbort.abort();
      const stats = await tailing;
      if (stats !== undefined) {
        this.logger.info(stats, "k6 live-data tailer complete");
      }
      this.logger.info(
        {
          emittedBucketCount: aggregator.emittedBucketCount,
          droppedLatePointCount: aggregator.droppedLatePointCount,
        },
        "k6 live-data aggregation complete"
      );
    }

    this.logger.info(
      {
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        stopReason: processResult.stopReason,
      },
      "k6 process complete"
    );

    // Both fields are null only when spawn failed. Non-zero k6 exits, including
    // threshold failures, still continue to reduction with their exact code.
    if (processResult.exitCode === null && processResult.signal === null) {
      throw new Error(`Failed to spawn k6 at "${this.binaryPath}".`);
    }

    return {
      exitCode: processResult.exitCode ?? signalExitCode(processResult.signal),
      stderrTail: processResult.stderrTail,
      stopReason: processResult.stopReason,
      startedAt,
      endedAt,
      artifacts: {
        kpiCsv: this.kpiCsvPath,
        kpiJson: this.kpiJsonPath,
      },
    };
  }

  async reduce(input: RunnerReduceInput): Promise<DltResultV1> {
    const { env, taskMetadata, runResult } = input;
    const result = await reduceK6KpiJson(this.kpiJsonPath, {
      testId: env.testId,
      taskId: taskMetadata.taskId,
      region: env.awsRegion,
      startedAt: runResult.startedAt,
      endedAt: runResult.endedAt,
      task: {
        vcpus: taskMetadata.taskCpu,
        memoryMiB: taskMetadata.taskMemory,
        // Keep the established ECS duration contract: container start through
        // test end, including setup and the wait for the start signal.
        ecsDurationSeconds: ecsDurationSeconds(taskMetadata, runResult.endedAt),
      },
    });

    this.logger.info(
      {
        requestCount: result.summary.totalRequestCount,
        labelCount: result.labels.length,
      },
      "k6 reduction complete"
    );
    return result;
  }
}
