// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveDataBucket, LiveDataEmitter } from "../../src/live-data/emitter.js";
import { JMeterLiveDataAggregator } from "../../src/live-data/jmeter-aggregator.js";
import { tailJMeterKpiJtl } from "../../src/live-data/tail-kpi-jtl.js";

const HEADER =
  "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success," +
  "failureMessage,bytes,sentBytes,grpThreads,allThreads,URL,Latency,IdleTime,Connect";

function makeEmitter(): LiveDataEmitter & { readonly buckets: LiveDataBucket[] } {
  const buckets: LiveDataBucket[] = [];
  return {
    buckets,
    emit(bucket) {
      buckets.push(bucket);
    },
  };
}

/** One JTL row, laid out the way a real 5.6.3 run writes it. */
function sample(options: {
  timeStamp: number;
  elapsed: number;
  label?: string;
  success?: boolean;
  allThreads?: number;
}): string {
  const label = options.label ?? "Sleep";
  const success = String(options.success ?? true);
  const threads = options.allThreads ?? 2;
  return `${options.timeStamp},${options.elapsed},${label},200,OK,TG 1-1,text,${success},,2,0,${threads},${threads},null,0,0,0`;
}

let testDir: string;
let jtlPath: string;
/** The second every fixture row completes in, given the mocked clock. */
let second: number;

beforeEach(async () => {
  // Held 700ms into the second the fixture rows complete in, so the tailer's tick
  // never reaches the watermark and only the final flush emits. Otherwise the
  // aggregator would gap-fill every second between the rows and "now", which is
  // correct but says nothing about the tailer.
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_700);
  second = 1_700_000_000_000;
  testDir = await mkdtemp(join(tmpdir(), "tail-jmeter-kpi-jtl-"));
  jtlPath = join(testDir, "kpi.jtl");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(testDir, { recursive: true, force: true });
});

describe("tailJMeterKpiJtl", () => {
  it("reads rows appended after the first poll", async () => {
    await writeFile(jtlPath, `${HEADER}\n${sample({ timeStamp: second + 100, elapsed: 100 })}\n`);

    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    const tailing = tailJMeterKpiJtl({
      kpiJtlPath: jtlPath,
      aggregator,
      signal: controller.signal,
      pollIntervalMilliseconds: 10,
    });

    await sleep(40);
    await appendFile(jtlPath, `${sample({ timeStamp: second + 300, elapsed: 200, success: false })}\n`);
    await sleep(40);
    controller.abort();

    const stats = await tailing;

    expect(stats).toEqual({ parsedRowCount: 2, unreadableRowCount: 0, lateRowCount: 0, parseErrorCount: 0 });
    expect(emitter.buckets).toEqual([
      {
        timestampMilliseconds: second,
        virtualUsers: 2,
        successCount: 1,
        failureCount: 1,
        averageResponseTimeMilliseconds: 150,
      },
    ]);
  });

  // csv-parse holds the header and any half-written row across writes, so a row
  // split between two reads must not be lost or double-counted.
  it("carries a row split across two reads", async () => {
    const row = sample({ timeStamp: second + 100, elapsed: 120 });
    const splitAt = Math.floor(row.length / 2);
    await writeFile(jtlPath, `${HEADER}\n${row.slice(0, splitAt)}`);

    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    const tailing = tailJMeterKpiJtl({
      kpiJtlPath: jtlPath,
      aggregator,
      signal: controller.signal,
      pollIntervalMilliseconds: 10,
    });

    await sleep(40);
    await appendFile(jtlPath, `${row.slice(splitAt)}\n`);
    await sleep(40);
    controller.abort();

    const stats = await tailing;

    expect(stats.parsedRowCount).toBe(1);
    expect(emitter.buckets[0]).toMatchObject({ successCount: 1, averageResponseTimeMilliseconds: 120 });
  });

  // The label is UTF-8 and a read can land mid-character. Bytes go to csv-parse
  // as bytes for exactly this reason.
  it("decodes a multi-byte label split across two reads", async () => {
    const row = sample({ timeStamp: second + 100, elapsed: 10, label: "Café–Übung" });
    const bytes = Buffer.from(`${HEADER}\n${row}\n`, "utf8");
    const labelByte = bytes.indexOf(Buffer.from("é", "utf8"));
    await writeFile(jtlPath, bytes.subarray(0, labelByte + 1));

    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    const tailing = tailJMeterKpiJtl({
      kpiJtlPath: jtlPath,
      aggregator,
      signal: controller.signal,
      pollIntervalMilliseconds: 10,
    });

    await sleep(40);
    await appendFile(jtlPath, bytes.subarray(labelByte + 1));
    await sleep(40);
    controller.abort();

    expect((await tailing).parsedRowCount).toBe(1);
    expect(emitter.buckets[0]?.successCount).toBe(1);
  });

  // JMeter quotes a field containing the delimiter or a newline — an assertion
  // failure message routinely contains both. Splitting on \n here would corrupt
  // those rows, which is why csv-parse owns the framing.
  it("reads a quoted field containing a comma and a newline", async () => {
    const failure = '"Assertion failed:\nexpected 200, got 500"';
    const row = `${second + 100},10,"Checkout, then pay",500,KO,TG 1-1,text,false,${failure},2,0,2,2,null,0,0,0`;
    await writeFile(jtlPath, `${HEADER}\n${row}\n`);

    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    controller.abort();

    const stats = await tailJMeterKpiJtl({ kpiJtlPath: jtlPath, aggregator, signal: controller.signal });

    // unreadableRowCount 0 is the real assertion: had the newline been treated as
    // a row break, the tail of the message would have arrived as a second row.
    expect(stats).toEqual({ parsedRowCount: 1, unreadableRowCount: 0, lateRowCount: 0, parseErrorCount: 0 });
    expect(emitter.buckets[0]).toMatchObject({ successCount: 0, failureCount: 1 });
  });

  it("counts a final row cut off mid-write without losing the rows before it", async () => {
    await writeFile(
      jtlPath,
      `${HEADER}\n${sample({ timeStamp: second + 100, elapsed: 10 })}\n${second + 200},,Sleep,200\n`
    );

    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    controller.abort();

    const stats = await tailJMeterKpiJtl({ kpiJtlPath: jtlPath, aggregator, signal: controller.signal });

    expect(stats).toMatchObject({ parsedRowCount: 1, unreadableRowCount: 1 });
    expect(emitter.buckets).toHaveLength(1);
  });

  // A row with no trailing newline is complete data; JMeter is killed mid-write on
  // the abort path, so this is the normal shape of the end of the file.
  it("reads a final row that has no trailing newline", async () => {
    await writeFile(jtlPath, `${HEADER}\n${sample({ timeStamp: second + 100, elapsed: 10 })}`);

    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    controller.abort();

    const stats = await tailJMeterKpiJtl({ kpiJtlPath: jtlPath, aggregator, signal: controller.signal });

    expect(stats.parsedRowCount).toBe(1);
    expect(emitter.buckets).toHaveLength(1);
  });

  it("emits nothing for a file that only ever gets a header", async () => {
    await writeFile(jtlPath, `${HEADER}\n`);

    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    controller.abort();

    const stats = await tailJMeterKpiJtl({ kpiJtlPath: jtlPath, aggregator, signal: controller.signal });

    expect(stats).toEqual({ parsedRowCount: 0, unreadableRowCount: 0, lateRowCount: 0, parseErrorCount: 0 });
    expect(emitter.buckets).toEqual([]);
  });

  it("stops promptly when aborted while waiting for the file", async () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();

    const tailing = tailJMeterKpiJtl({
      kpiJtlPath: join(testDir, "missing.jtl"),
      aggregator,
      signal: controller.signal,
      pollIntervalMilliseconds: 10_000,
    });
    await sleep(10);
    controller.abort();

    await expect(tailing).resolves.toEqual({
      parsedRowCount: 0,
      unreadableRowCount: 0,
      lateRowCount: 0,
      parseErrorCount: 0,
    });
    expect(emitter.buckets).toEqual([]);
  });

  // JMeter starts writing the JTL only once a sample completes, which can be well
  // after the process starts.
  it("waits for a file that does not exist yet", async () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);
    const controller = new AbortController();
    const tailing = tailJMeterKpiJtl({
      kpiJtlPath: jtlPath,
      aggregator,
      signal: controller.signal,
      pollIntervalMilliseconds: 10,
    });

    await sleep(30);
    await writeFile(jtlPath, `${HEADER}\n${sample({ timeStamp: second + 100, elapsed: 10 })}\n`);
    await sleep(40);
    controller.abort();

    expect((await tailing).parsedRowCount).toBe(1);
    expect(emitter.buckets).toHaveLength(1);
  });
});
