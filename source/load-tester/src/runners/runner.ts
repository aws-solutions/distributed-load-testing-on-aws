// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DltResultV1 } from "@amzn/dlt-common";
import type { S3Client } from "@aws-sdk/client-s3";

import type { EcsTaskMetadata } from "../ecs-metadata.js";
import type { RunnerConfig } from "../env.js";
import type { LiveDataEmitter } from "../live-data/emitter.js";
import type { StopReason } from "../process/process-supervisor.js";

export interface FrameworkRunner {
  readonly name: "jmeter" | "k6" | "locust";

  /** Set up framework-specific artifacts on disk before the test starts.
   *  Called after script download, before process spawn. Must be idempotent. */
  prepare(input: RunnerPrepareInput): Promise<void>;

  /** Spawn the framework process and wait for it to exit. Emits live-data
   *  events during execution. Returns the exit code (does NOT throw on
   *  non-zero — interpretation happens in reduce). Must respect abortSignal
   *  by initiating graceful framework shutdown when it fires. */
  run(input: RunnerRunInput): Promise<RunnerRunResult>;

  /** Transform framework-native output artifacts into a dlt.result.v1
   *  object. Called after run() completes regardless of exit code. Produces
   *  partial results when artifacts are incomplete (e.g. aborted mid-test). */
  reduce(input: RunnerReduceInput): Promise<DltResultV1>;
}

export interface RunnerPrepareInput {
  readonly env: RunnerConfig;
  readonly taskMetadata: EcsTaskMetadata;
  readonly s3Client: S3Client;
  readonly scenariosBucket: string;
}

export interface RunnerRunInput {
  readonly env: RunnerConfig;
  readonly taskMetadata: EcsTaskMetadata;
  readonly liveDataEmitter: LiveDataEmitter;
  /** Fires on container SIGTERM or max-duration timer expiry. */
  readonly abortSignal: AbortSignal;
}

export interface RunnerRunResult {
  readonly exitCode: number;
  readonly stderrTail: string;
  readonly stopReason: StopReason;
  readonly startedAt: Date;
  readonly endedAt: Date;
  /** Absolute paths to framework-specific artifacts the reducer reads. */
  readonly artifacts: Readonly<Record<string, string>>;
}

export interface RunnerReduceInput {
  readonly env: RunnerConfig;
  readonly taskMetadata: EcsTaskMetadata;
  readonly runResult: RunnerRunResult;
}
