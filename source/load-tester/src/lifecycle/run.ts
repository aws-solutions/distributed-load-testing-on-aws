// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Container lifecycle — framework-agnostic orchestration.
//
// Phases:
//   Setup     → download config + script, prepare runner, wait for start signal
//   Running   → execute the framework process, emit live-data
//   Finalize  → reduce results, upload artifacts, write completion marker
//   Idle      → keep-alive until ECS drains the service (exit 0 on SIGTERM)

import fs from "node:fs";
import path from "node:path";

import {
  DLT_FRAMEWORK_EXIT_V1_SCHEMA,
  TEST_TYPE_TO_FRAMEWORK,
  artifactKeyPrefix,
  completionMarkerKey,
  sanitizeStopReason,
  type DltFrameworkExitV1,
  type LoadTestFramework,
} from "@amzn/dlt-common";
import type { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { findScript } from "../archive/find-script.js";
import { unzip } from "../archive/unzip.js";
import type { EcsTaskMetadata } from "../ecs-metadata.js";
import type { ContainerConfig, RunnerConfig } from "../env.js";
import type { LiveDataEmitter } from "../live-data/emitter.js";
import type { Logger } from "../logger.js";
import type { FrameworkRunner } from "../runners/runner.js";
import { createS3Client } from "../s3/client.js";
import { downloadScript } from "../s3/download-script.js";
import { downloadTestConfig } from "../s3/download-test-config.js";
import { uploadArtifacts } from "../s3/upload-artifacts.js";
import { waitForStartSignal } from "../s3/wait-for-start.js";
import { createSignalManager } from "../signals/sigterm.js";

export interface RunLifecycleInput {
  readonly env: ContainerConfig;
  readonly taskMetadata: EcsTaskMetadata;
  readonly runner: FrameworkRunner;
  readonly liveDataEmitter: LiveDataEmitter;
  readonly logger: Logger;
}

export async function runLifecycle(input: RunLifecycleInput): Promise<void> {
  const { env, taskMetadata, runner, liveDataEmitter, logger } = input;
  const s3 = createS3Client({ region: env.mainStackRegion });
  const framework = TEST_TYPE_TO_FRAMEWORK[env.testType];

  const workDir = "/tmp/work";
  const artifactsDir = "/tmp/artifacts";
  await Promise.all([
    fs.promises.mkdir(workDir, { recursive: true }),
    fs.promises.mkdir(artifactsDir, { recursive: true }),
  ]);

  // Single signal manager for the container's lifetime. Phase transitions
  // change SIGTERM behavior without installing/removing handlers.
  const signals = createSignalManager({ logger });

  // ─── Setup ───────────────────────────────────────────────────────────
  // SIGTERM during setup aborts and exits 143 (nothing useful has run yet).

  const setupAbort = new AbortController();
  signals.setAbortCallback(() => {
    setupAbort.abort();
  });

  await downloadTestConfig({
    s3,
    bucket: env.s3Bucket,
    testId: env.testId,
    testRegion: env.awsRegion,
    destPath: path.join(workDir, "test-config.json"),
    logger,
  });

  const testScriptPath = await resolveTestScript({ env, framework, workDir, s3, logger });

  const runnerConfig: RunnerConfig = {
    testId: env.testId,
    framework,
    awsRegion: env.awsRegion,
    liveDataEnabled: env.liveDataEnabled,
    testScriptPath,
    artifactsDir,
  };

  await runner.prepare({ env: runnerConfig, taskMetadata, s3Client: s3, scenariosBucket: env.s3Bucket });

  // ECS health check passes once this marker exists.
  await fs.promises.writeFile("/tmp/health_ready", "");

  logger.info("setup complete");

  // Block until the start-command Lambda writes the start signal to S3,
  // indicating all regions have stabilized and tests can begin.
  await waitForStartSignal({
    s3,
    bucket: env.s3Bucket,
    testId: env.testId,
    prefix: env.prefix,
    awsRegion: env.awsRegion,
    signal: setupAbort.signal,
    logger,
  });

  // ─── Running ─────────────────────────────────────────────────────────
  // SIGTERM during running forwards the signal to the framework runner,
  // allowing it to shut down gracefully (e.g. flush stats, send final metrics).
  // Then all artifacts are uploaded before shutting down.

  logger.info("start signal received - running load test");

  signals.setPhase("running");
  const runAbort = new AbortController();
  signals.setAbortCallback(() => {
    runAbort.abort();
  });

  const runResult = await (async () => {
    const maxDurationTimer = setTimeout(() => {
      logger.error(
        { maxDurationSeconds: env.maxDurationSeconds },
        "maximum test duration reached - aborting load test"
      );
      runAbort.abort();
    }, env.maxDurationSeconds * 1000);

    try {
      return await runner.run({
        env: runnerConfig,
        taskMetadata,
        liveDataEmitter,
        abortSignal: runAbort.signal,
      });
    } finally {
      clearTimeout(maxDurationTimer);
    }
  })();
  const frameworkExit = createFrameworkExitArtifact({ env, taskMetadata, runner, runResult });
  if (frameworkExit) {
    logger.error(
      { exitCode: runResult.exitCode, error: frameworkExit.message },
      "load test framework exited non-zero - finalizing available results"
    );
  } else {
    logger.info(
      { exitCode: runResult.exitCode, stopReason: runResult.stopReason },
      "load test complete - finalizing results"
    );
  }

  // ─── Finalize ────────────────────────────────────────────────────────
  // SIGTERM during finalize is ignored — we're uploading results and will
  // be done before the ECS stop timeout.

  signals.setPhase("finalizing");

  let finalizationError: unknown;

  if (frameworkExit) {
    try {
      await fs.promises.writeFile(path.join(artifactsDir, "framework-exit.json"), JSON.stringify(frameworkExit));
    } catch (error) {
      finalizationError = error;
      logger.error({ err: error }, "could not write framework-exit artifact");
    }
  }

  try {
    const result = await runner.reduce({ env: runnerConfig, taskMetadata, runResult });
    await fs.promises.writeFile(path.join(artifactsDir, "result.json"), JSON.stringify(result));
  } catch (error) {
    if (!frameworkExit) {
      finalizationError ??= error;
    }
    logger.error({ err: error }, "could not reduce load test results");
  }

  const keyPrefix = artifactKeyPrefix(env.testId, env.prefix, env.awsRegion, taskMetadata.taskId);
  await uploadArtifacts({
    s3,
    bucket: env.s3Bucket,
    keyPrefix,
    artifactsDir,
    requiredFiles: frameworkExit ? ["framework-exit.json", "result.json"] : ["result.json"],
    logger,
  });

  if (finalizationError) {
    if (finalizationError instanceof Error) {
      throw finalizationError;
    }
    throw new Error("load test finalization failed", { cause: finalizationError });
  }

  // Zero-byte marker that task-status-checker counts (via ListObjectsV2)
  // to determine how many tasks in this region have finished.
  await writeCompletionMarker(s3, env, taskMetadata, frameworkExit !== undefined);
  logger.info("finalize complete - waiting for termination");

  // ─── Idle ────────────────────────────────────────────────────────────
  // Test is done. Wait for test-cleanup to set desiredCount=0, which
  // triggers ECS to send SIGTERM → exit 0.

  signals.setPhase("idle");
  if (signals.terminationRequested) {
    return process.exit(0);
  }
  // Keep the event loop alive until SIGTERM exits the process.
  setInterval(() => {
    /* no-op keep-alive */
  }, env.maxDurationSeconds * 1000);
  await new Promise<void>(() => {
    /* never resolves — SIGTERM handler calls process.exit */
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function createFrameworkExitArtifact(input: {
  readonly env: ContainerConfig;
  readonly taskMetadata: EcsTaskMetadata;
  readonly runner: FrameworkRunner;
  readonly runResult: Awaited<ReturnType<FrameworkRunner["run"]>>;
}): DltFrameworkExitV1 | undefined {
  if (input.runResult.exitCode === 0 || input.runResult.stopReason !== "natural") {
    return undefined;
  }

  const fallback = `Native ${input.runner.name} process exited with code ${input.runResult.exitCode}`;
  return {
    schema: DLT_FRAMEWORK_EXIT_V1_SCHEMA,
    timestamp: input.runResult.endedAt.toISOString(),
    testId: input.env.testId,
    testRunId: input.env.testRunId,
    taskId: input.taskMetadata.taskId,
    region: input.env.awsRegion,
    framework: input.runner.name,
    exitCode: input.runResult.exitCode,
    message: sanitizeStopReason(input.runResult.stderrTail) || fallback,
    stopReason: "natural",
  };
}

async function writeCompletionMarker(
  s3: S3Client,
  env: ContainerConfig,
  taskMetadata: EcsTaskMetadata,
  warning: boolean
): Promise<void> {
  const key = completionMarkerKey(env.testId, env.prefix, env.awsRegion, taskMetadata.taskId, warning);
  await s3.send(new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: "" }));
}

interface ResolveTestScriptInput {
  readonly env: ContainerConfig;
  readonly framework: LoadTestFramework;
  readonly workDir: string;
  readonly s3: S3Client;
  readonly logger: Logger;
}

async function resolveTestScript(input: ResolveTestScriptInput): Promise<string> {
  const { env, framework, workDir, s3, logger } = input;

  if (env.fileType === "none") {
    throw new Error("fileType=none is not supported in native mode (no script to run)");
  }

  const { localPath } = await downloadScript({
    s3,
    bucket: env.s3Bucket,
    testId: env.testId,
    framework,
    fileType: env.fileType,
    destDir: workDir,
    logger,
  });

  if (env.fileType === "zip") {
    const extractDir = path.join(workDir, "scripts");
    await fs.promises.mkdir(extractDir, { recursive: true });
    await unzip({ zipPath: localPath, destDir: extractDir, logger });
    return findScript({ dir: extractDir, framework });
  }

  return localPath;
}
