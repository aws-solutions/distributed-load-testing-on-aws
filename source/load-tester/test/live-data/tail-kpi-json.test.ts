// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { K6LiveDataAggregator } from "../../src/live-data/k6-aggregator.js";
import type { LiveDataBucket, LiveDataEmitter } from "../../src/live-data/emitter.js";
import { tailK6KpiJson } from "../../src/live-data/tail-kpi-json.js";

function makeEmitter(): LiveDataEmitter & { readonly buckets: LiveDataBucket[] } {
  const buckets: LiveDataBucket[] = [];
  return {
    buckets,
    emit(bucket) {
      buckets.push(bucket);
    },
  };
}

function point(metric: string, timestampMilliseconds: number, value: number): string {
  return JSON.stringify({
    type: "Point",
    metric,
    data: {
      time: new Date(timestampMilliseconds).toISOString(),
      value,
    },
  });
}

let testDir: string;

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_500);
  testDir = await mkdtemp(join(tmpdir(), "tail-k6-kpi-json-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(testDir, { recursive: true, force: true });
});

describe("tailK6KpiJson", () => {
  it("carries split lines and parses a complete final line without a newline", async () => {
    const filePath = join(testDir, "kpi.json");
    const second = Math.floor(Date.now() / 1_000) * 1_000;
    const request = point("http_reqs", second + 100, 1);
    const splitAt = Math.floor(request.length / 2);

    await writeFile(
      filePath,
      [
        "not json",
        JSON.stringify({ type: "Metric", metric: "http_reqs", data: { type: "counter" } }),
        request.slice(0, splitAt),
      ].join("\n")
    );

    const emitter = makeEmitter();
    const aggregator = new K6LiveDataAggregator(emitter);
    const controller = new AbortController();
    const tailing = tailK6KpiJson({
      kpiJsonPath: filePath,
      aggregator,
      signal: controller.signal,
      pollIntervalMilliseconds: 10_000,
    });

    await sleep(20);
    await appendFile(
      filePath,
      [
        request.slice(splitAt),
        point("http_req_failed", second + 200, 0),
        point("http_req_duration", second + 300, 80),
        point("ws_sessions", second + 400, 1),
        point("vus", second + 500, 3),
      ].join("\n")
    );
    controller.abort();

    const stats = await tailing;

    expect(stats).toEqual({
      parsedPointCount: 4,
      malformedLineCount: 1,
      unsupportedLineCount: 2,
    });
    expect(emitter.buckets).toEqual([
      {
        timestampMilliseconds: second,
        virtualUsers: 3,
        successCount: 1,
        failureCount: 0,
        averageResponseTimeMilliseconds: 80,
      },
    ]);
  });

  it("ignores an incomplete final fragment", async () => {
    const filePath = join(testDir, "kpi.json");
    const second = Math.floor(Date.now() / 1_000) * 1_000;
    await writeFile(filePath, `${point("http_reqs", second, 1)}\n{"type":"Point"`);

    const emitter = makeEmitter();
    const aggregator = new K6LiveDataAggregator(emitter);
    const controller = new AbortController();
    controller.abort();

    const stats = await tailK6KpiJson({
      kpiJsonPath: filePath,
      aggregator,
      signal: controller.signal,
    });

    expect(stats.parsedPointCount).toBe(1);
    expect(stats.malformedLineCount).toBe(1);
    expect(emitter.buckets).toHaveLength(1);
  });

  it("stops promptly when aborted while waiting for the file", async () => {
    const emitter = makeEmitter();
    const aggregator = new K6LiveDataAggregator(emitter);
    const controller = new AbortController();

    const tailing = tailK6KpiJson({
      kpiJsonPath: join(testDir, "missing.json"),
      aggregator,
      signal: controller.signal,
      pollIntervalMilliseconds: 10_000,
    });
    await sleep(10);
    controller.abort();

    await expect(tailing).resolves.toEqual({
      parsedPointCount: 0,
      malformedLineCount: 0,
      unsupportedLineCount: 0,
    });
    expect(emitter.buckets).toEqual([]);
  });
});
