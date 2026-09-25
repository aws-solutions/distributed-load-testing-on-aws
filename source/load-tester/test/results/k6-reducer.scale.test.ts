// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, expect, it } from "vitest";

import { reduceK6KpiJson } from "../../src/results/k6-reducer.js";
import type { KpiResultContext } from "../../src/results/reduce-kpi-rows.js";

const REQUESTS = 250_000;
const LABELS = 100;
const runScaleTest = process.env["RUN_K6_REDUCER_SCALE_TEST"] === "true" ? it : it.skip;

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "k6-reducer-scale-"));
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

runScaleTest(
  "reduces 250,000 requests and 100 labels within the Session 5 envelope",
  async () => {
    const filePath = join(testDir, "kpi.json");
    const generationStarted = performance.now();
    await writeFixture(filePath);
    const generationMs = performance.now() - generationStarted;
    const artifactBytes = (await stat(filePath)).size;

    let peakHeapBytes = process.memoryUsage().heapUsed;
    const sampleHeap = setInterval(() => {
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    }, 10);
    const reductionStarted = performance.now();
    const result = await reduceK6KpiJson(filePath, CONTEXT);
    const reductionMs = performance.now() - reductionStarted;
    clearInterval(sampleHeap);

    console.info(
      JSON.stringify({
        requests: REQUESTS,
        labels: LABELS,
        artifactMiB: artifactBytes / 1024 / 1024,
        generationSeconds: generationMs / 1000,
        reductionSeconds: reductionMs / 1000,
        peakHeapMiB: peakHeapBytes / 1024 / 1024,
      })
    );

    expect(reductionMs).toBeLessThan(120_000);
    expect(result.summary).toMatchObject({
      successCount: 225_000,
      failureCount: 25_000,
      totalRequestCount: REQUESTS,
      concurrency: LABELS,
      totalBytesReceived: REQUESTS * 128,
      averageResponseTimeMilliseconds: 500.5,
      minResponseTimeMilliseconds: 1,
      p50: 500,
      p90: 900,
      p95: 950,
      p99: 990,
      p99_9: 999,
      maxResponseTimeMilliseconds: 1000,
    });
    expect(result.labels).toHaveLength(LABELS);
    expect(result.labels.every((label) => label.totalRequestCount === REQUESTS / LABELS)).toBe(true);
  },
  120_000
);

const CONTEXT: KpiResultContext = {
  testId: "scale-test",
  taskId: "task-1",
  region: "us-east-1",
  startedAt: new Date("2026-08-14T12:00:00.000Z"),
  endedAt: new Date("2026-08-14T12:10:00.000Z"),
  task: { vcpus: 2, memoryMiB: 4096, ecsDurationSeconds: 620 },
};

async function writeFixture(filePath: string): Promise<void> {
  const output = createWriteStream(filePath);
  let chunk = point("vus", LABELS);

  for (let i = 0; i < REQUESTS; i += 1) {
    const failed = i % 10 === 0;
    const tags = { name: `label-${i % LABELS}`, status: failed ? "500" : "200" };
    chunk += point("http_reqs", 1, tags);
    chunk += point("http_req_failed", failed ? 1 : 0, tags);
    chunk += point("http_req_duration", (i % 1000) + 1, tags);
    chunk += point("data_received", 128);

    if (chunk.length >= 1024 * 1024) {
      if (!output.write(chunk)) await once(output, "drain");
      chunk = "";
    }
  }

  output.end(chunk);
  await once(output, "finish");
}

function point(metric: string, value: number, tags?: Readonly<Record<string, string>>): string {
  return `${JSON.stringify({
    type: "Point",
    metric,
    data: { value, ...(tags === undefined ? {} : { tags }) },
  })}\n`;
}
