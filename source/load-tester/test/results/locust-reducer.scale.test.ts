// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import type { S3Client } from "@aws-sdk/client-s3";
import { expect, it, vi } from "vitest";

import type { EcsTaskMetadata } from "../../src/ecs-metadata.js";
import type { RunnerConfig } from "../../src/env.js";
import type { Logger } from "../../src/logger.js";
import { LocustRunner } from "../../src/runners/locust.js";
import type { RunnerRunResult } from "../../src/runners/runner.js";

const REQUESTS = 5_000_000;
const LABELS = 100;
const PREVIOUS_PEAK_RSS_MIB = 1_108;
const EXPECTED_STREAMING_PEAK_RSS_MIB = 428;
const MAX_PEAK_RSS_MIB = 600;
const runScaleTest = process.env["RUN_LOCUST_REDUCER_SCALE_TEST"] === "true" ? it : it.skip;

runScaleTest(
  "streams 5 million requests and 100 labels below the RSS ceiling",
  async () => {
    const testDir = await mkdtemp(join(tmpdir(), "locust-reducer-scale-"));

    try {
      const config = { ...CONFIG, artifactsDir: testDir };
      const filePath = join(testDir, "kpi.csv");
      const generationStarted = performance.now();
      await writeFixture(filePath);
      const generationMs = performance.now() - generationStarted;
      const artifactBytes = (await stat(filePath)).size;

      const runner = new LocustRunner({ info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger);
      await runner.prepare({
        env: config,
        taskMetadata: TASK_METADATA,
        s3Client: {} as S3Client,
        scenariosBucket: "unused",
      });

      let peakRssBytes = process.memoryUsage().rss;
      const sampleRss = setInterval(() => {
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      }, 10);
      const reductionStarted = performance.now();
      const result = await runner
        .reduce({
          env: config,
          taskMetadata: TASK_METADATA,
          runResult: RUN_RESULT,
        })
        .finally(() => {
          clearInterval(sampleRss);
        });
      const reductionMs = performance.now() - reductionStarted;
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      const peakRssMiB = peakRssBytes / 1024 / 1024;

      console.info(
        JSON.stringify({
          requests: REQUESTS,
          labels: LABELS,
          artifactMiB: artifactBytes / 1024 / 1024,
          generationSeconds: generationMs / 1000,
          reductionSeconds: reductionMs / 1000,
          previousPeakRssMiB: PREVIOUS_PEAK_RSS_MIB,
          expectedStreamingPeakRssMiB: EXPECTED_STREAMING_PEAK_RSS_MIB,
          maxPeakRssMiB: MAX_PEAK_RSS_MIB,
          peakRssMiB,
        })
      );

      expect(peakRssMiB).toBeLessThanOrEqual(MAX_PEAK_RSS_MIB);
      expect(result.summary).toMatchObject({
        successCount: 4_500_000,
        failureCount: 500_000,
        totalRequestCount: REQUESTS,
        concurrency: LABELS,
        totalBytesReceived: REQUESTS * 128,
        minResponseTimeMilliseconds: 1,
        maxResponseTimeMilliseconds: 1000,
        responseCodes: [
          { code: "200", count: 4_500_000 },
          { code: "500", count: 500_000 },
        ],
      });
      expect(result.summary.averageResponseTimeMilliseconds).toBeCloseTo(500.5, 9);
      expectHistogramEstimate(result.summary.p50, 500);
      expectHistogramEstimate(result.summary.p90, 900);
      expectHistogramEstimate(result.summary.p95, 950);
      expectHistogramEstimate(result.summary.p99, 990);
      expectHistogramEstimate(result.summary.p99_9, 999);
      expect(result.labels).toHaveLength(LABELS);
      expect(result.labels.every((label) => label.totalRequestCount === REQUESTS / LABELS)).toBe(true);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  },
  300_000
);

const CONFIG: RunnerConfig = {
  testId: "scale-test",
  framework: "locust",
  awsRegion: "us-east-1",
  liveDataEnabled: false,
  testScriptPath: "/unused/locustfile.py",
  artifactsDir: "/unused",
};

const TASK_METADATA: EcsTaskMetadata = {
  taskArn: "arn:aws:ecs:us-east-1:123456789012:task/cluster/task-1",
  taskId: "task-1",
  taskCpu: 2,
  taskMemory: 4096,
  startedAt: "2026-08-14T11:59:40.000Z",
};

const RUN_RESULT: RunnerRunResult = {
  exitCode: 0,
  stderrTail: "",
  stopReason: "natural",
  startedAt: new Date("2026-08-14T12:00:00.000Z"),
  endedAt: new Date("2026-08-14T12:10:00.000Z"),
  artifacts: {},
};

function expectHistogramEstimate(actual: number, expected: number): void {
  expect(actual).toBeGreaterThanOrEqual(expected * 0.995);
  expect(actual).toBeLessThanOrEqual(expected * 1.005);
}

async function writeFixture(filePath: string): Promise<void> {
  const output = createWriteStream(filePath);
  let chunk =
    "timestamp,method,name,response_time_ms,response_length_bytes,status_code,success," +
    "exception_type,exception_message,user_count,context_json\n";

  for (let i = 0; i < REQUESTS; i += 1) {
    const failed = i % 10 === 0;
    chunk +=
      `1700000000,GET,label-${i % LABELS},${(i % 1000) + 1},128,${failed ? "500,false" : "200,true"}` +
      `,,,${LABELS},\n`;

    if (chunk.length >= 1024 * 1024) {
      if (!output.write(chunk)) await once(output, "drain");
      chunk = "";
    }
  }

  output.end(chunk);
  await once(output, "finish");
}
