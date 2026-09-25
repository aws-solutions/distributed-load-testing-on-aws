// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Runs a load test with Apache JMeter.
//
// The customer's .jmx runs exactly as authored: DLT passes no load or duration
// properties and never rewrites the plan, so the plan alone decides the load.
// maxTestDurationSeconds stays DLT's own safety timeout, enforced by the lifecycle
// aborting this runner rather than by anything inside JMeter.
//
// JMeter writes one CSV row per completed sample to kpi.jtl. The same file feeds
// live data while the test runs and the final result afterwards.

import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DltResultV1 } from "@amzn/dlt-common";

import { ecsDurationSeconds } from "../ecs-metadata.js";
import { installJMeter } from "../jmeter/install-jmeter.js";
import { buildJMeterArgs, jmeterArtifactPaths } from "../jmeter/jmeter-args.js";
import { stopJMeter } from "../jmeter/shutdown.js";
import { JMeterLiveDataAggregator } from "../live-data/jmeter-aggregator.js";
import { tailJMeterKpiJtl } from "../live-data/tail-kpi-jtl.js";
import type { Logger } from "../logger.js";
import { superviseProcess } from "../process/process-supervisor.js";
import { parseJmeterKpiJtl } from "../results/jmeter-reducer.js";
import { reduceKpiRows, type KpiRow } from "../results/reduce-kpi-rows.js";
import { signalExitCode } from "./exit-code.js";
import type {
  FrameworkRunner,
  RunnerPrepareInput,
  RunnerReduceInput,
  RunnerRunInput,
  RunnerRunResult,
} from "./runner.js";

/**
 * Maximum time from abort until JMeter is force-killed. The stoptest.sh request
 * runs inside this deadline rather than before it.
 *
 * This grace period controls how much time we allocate to JMeter to stop before
 * the task begins uploading artifacts to S3. This only fires when the test's
 * max duration is exceeded or ECS receives a SIGTERM signal as part of some
 * failure path.
 */
const GRACE_PERIOD_MILLISECONDS = 12_000;
const JMETER_LOG_SCAN_BYTES = 64 * 1024;
const JMETER_ERROR_ENTRY = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} ERROR /gm;
const JMETER_LOG_ENTRY = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} (?:TRACE|DEBUG|INFO|WARN|ERROR) /m;

export class JMeterRunner implements FrameworkRunner {
  readonly name = "jmeter" as const;

  private jmeterHome = "";
  private scriptDir = "";
  private kpiJtlPath = "";
  private jmeterLogPath = "";

  constructor(private readonly logger: Logger) {}

  async prepare(input: RunnerPrepareInput): Promise<void> {
    // Run from the script's own directory so a CSV data set or included plan that
    // the customer's zip references by relative path resolves.
    this.scriptDir = dirname(input.env.testScriptPath);
    const paths = jmeterArtifactPaths(input.env.artifactsDir);
    this.kpiJtlPath = paths.kpiJtlPath;
    this.jmeterLogPath = paths.jmeterLogPath;

    this.logger.info("installing JMeter runtime");
    this.jmeterHome = await installJMeter({
      s3: input.s3Client,
      bucket: input.scenariosBucket,
      temporaryDirectory: tmpdir(),
    });
    this.logger.info({ jmeterHome: this.jmeterHome }, "JMeter runtime installed");
  }

  async run(input: RunnerRunInput): Promise<RunnerRunResult> {
    if (this.jmeterHome === "") {
      throw new Error("JMeterRunner.prepare() must complete before run().");
    }

    const launcherPath = join(this.jmeterHome, "bin", "jmeter");
    const args = buildJMeterArgs({
      scriptPath: input.env.testScriptPath,
      kpiJtlPath: this.kpiJtlPath,
      jmeterLogPath: this.jmeterLogPath,
    });

    const aggregator = new JMeterLiveDataAggregator(input.liveDataEmitter);
    const tailerAbort = new AbortController();
    // Only tail when live data is switched on. The emitter is a no-op either way,
    // but parsing every row a second time is real work on a busy task.
    const tailing = input.env.liveDataEnabled
      ? tailJMeterKpiJtl({
          kpiJtlPath: this.kpiJtlPath,
          aggregator,
          signal: tailerAbort.signal,
        }).catch((err: unknown) => {
          // Live data is best-effort. Final reduction reads the same file and must
          // still run if incremental tailing hits a file error.
          this.logger.error({ err }, "JMeter live-data tailer failed");
          return undefined;
        })
      : undefined;

    this.logger.info({ kpiJtlPath: this.kpiJtlPath, jmeterLogPath: this.jmeterLogPath }, "starting JMeter");

    const startedAt = new Date();
    let endedAt: Date;
    let processResult: Awaited<ReturnType<typeof superviseProcess>>;
    try {
      processResult = await superviseProcess({
        command: launcherPath,
        args,
        cwd: this.scriptDir,
        // No env on purpose. superviseProcess passes this straight to spawn, where
        // undefined means inherit — which is how JVM_ARGS, set on the hub task
        // definition and merged into every native task, reaches bin/jmeter. An
        // explicit env object would replace the environment and silently drop the
        // customer's heap settings.
        abortSignal: input.abortSignal,
        gracePeriodMs: GRACE_PERIOD_MILLISECONDS,
        onAbort: () => this.stopJMeterForAbort(),
      });
      endedAt = new Date();
    } finally {
      // JMeter has stopped writing by now, so the tailer can read the rows it
      // flushed on the way out before it is shut down.
      tailerAbort.abort();
      const stats = await tailing;
      if (stats !== undefined) {
        this.logger.info(stats, "JMeter live-data tailer complete");
      }
      this.logger.info(
        {
          emittedBucketCount: aggregator.emittedBucketCount,
          droppedLateRowCount: aggregator.droppedLateRowCount,
        },
        "JMeter live-data aggregation complete"
      );
    }

    this.logger.info(
      {
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        stopReason: processResult.stopReason,
      },
      "JMeter process complete"
    );

    // Both fields are null only when spawn failed. A non-zero exit still goes to
    // reduction with its exact code — and so does a clean one after an abort, which
    // is what JMeter reports when stoptest.sh cuts a run short.
    if (processResult.exitCode === null && processResult.signal === null) {
      throw new Error(`Failed to spawn JMeter at "${launcherPath}".`);
    }

    const exitCode = processResult.exitCode ?? signalExitCode(processResult.signal); // exit code or termination signal
    const jmeterError = exitCode === 0 ? "" : await readLastJMeterError(this.jmeterLogPath);

    return {
      exitCode,
      // JMeter writes plan-load failures to jmeter.log rather than stderr.
      // Keep stderr as the fallback for launcher and JVM failures.
      stderrTail: jmeterError || processResult.stderrTail,
      stopReason: processResult.stopReason,
      startedAt,
      endedAt,
      artifacts: {
        kpiJtl: this.kpiJtlPath,
        jmeterLog: this.jmeterLogPath,
      },
    };
  }

  /**
   * Never throws. Whatever state kpi.jtl is in, the caller still needs a result to
   * upload — the completion marker written after this is what tells DLT the task
   * finished, and skipping it hangs the whole test in every region.
   */
  async reduce(input: RunnerReduceInput): Promise<DltResultV1> {
    const { env, taskMetadata, runResult } = input;

    const result = await reduceKpiRows(this.readKpiRows(), {
      testId: env.testId,
      taskId: taskMetadata.taskId,
      region: env.awsRegion,
      startedAt: runResult.startedAt,
      endedAt: runResult.endedAt,
      task: {
        vcpus: taskMetadata.taskCpu,
        memoryMiB: taskMetadata.taskMemory,
        ecsDurationSeconds: ecsDurationSeconds(taskMetadata, runResult.endedAt),
      },
    });

    this.logger.info(
      {
        requestCount: result.summary.totalRequestCount,
        labelCount: result.labels.length,
      },
      "JMeter reduction complete"
    );
    return result;
  }

  /**
   * Streams the JTL, and stops quietly if reading fails part-way through.
   *
   * Swallowing the error inside the generator is what preserves a partial result:
   * the iteration simply ends, so reduceKpiRows keeps everything it had already
   * aggregated. Letting it propagate would discard that, since reduceKpiRows
   * aggregates as it consumes. A missing file — a plan that completed no sample, or
   * a task killed before JMeter created it — takes the same path and yields an
   * all-zero result.
   */
  private async *readKpiRows(): AsyncGenerator<KpiRow, void, void> {
    try {
      for await (const row of parseJmeterKpiJtl(createReadStream(this.kpiJtlPath))) {
        yield row;
      }
    } catch (err) {
      this.logger.error({ err }, "reading kpi.jtl failed - reducing the rows read so far");
    }
  }

  /**
   * The abort hook superviseProcess calls. Asks JMeter to stop so it finalizes the
   * JTL, and logs a failure rather than propagating it: the supervisor discards
   * anything thrown here, so an unlogged error would vanish, and the grace-period
   * SIGKILL is the backstop either way.
   */
  private async stopJMeterForAbort(): Promise<void> {
    this.logger.info("test aborted - asking JMeter to stop and flush the JTL");
    try {
      await stopJMeter({ jmeterHome: this.jmeterHome });
    } catch (err) {
      this.logger.error({ err }, "could not stop JMeter - waiting for the grace period to SIGKILL it");
    }
  }
}

/**
 * Reads only the end of jmeter.log and returns its final ERROR record, including
 * an attached multiline stack trace. JMeter sends errors through stdout instead
 * of stderr, so we must parse relevant error logs from unrelated noise.
 */
async function readLastJMeterError(logPath: string): Promise<string> {
  let file: Awaited<ReturnType<typeof open>> | undefined;

  try {
    file = await open(logPath, "r");
    const { size } = await file.stat();
    if (size === 0) return "";

    const length = Math.min(size, JMETER_LOG_SCAN_BYTES);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);

    const tail = buffer.toString("utf8");
    const errorStart = [...tail.matchAll(JMETER_ERROR_ENTRY)].at(-1)?.index;
    if (errorStart === undefined) return "";

    const errorAndRemainder = tail.slice(errorStart);
    const nextEntry = errorAndRemainder.slice(1).search(JMETER_LOG_ENTRY);
    return errorAndRemainder.slice(0, nextEntry < 0 ? undefined : nextEntry + 1).trim();
  } catch {
    return "";
  } finally {
    await file?.close().catch(() => undefined);
  }
}
