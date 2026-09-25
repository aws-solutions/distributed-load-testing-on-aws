// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { JMeterLiveDataAggregator } from "../../src/live-data/jmeter-aggregator.js";
import type { LiveDataBucket, LiveDataEmitter } from "../../src/live-data/emitter.js";
import type { KpiRow } from "../../src/results/reduce-kpi-rows.js";

const SECOND = 1_700_000_000_000;

function makeEmitter(): LiveDataEmitter & { readonly buckets: LiveDataBucket[] } {
  const buckets: LiveDataBucket[] = [];
  return {
    buckets,
    emit(bucket) {
      buckets.push(bucket);
    },
  };
}

/** A completed request. `startedAt` is milliseconds after SECOND. */
function row(options: { startedAt: number; elapsed: number; success?: boolean; allThreads?: number }): KpiRow {
  return {
    timeStamp: SECOND + options.startedAt,
    elapsed: options.elapsed,
    label: "/api",
    responseCode: "200",
    success: options.success ?? true,
    bytes: 0,
    allThreads: options.allThreads ?? 1,
    latency: 0,
    connect: 0,
  };
}

describe("JMeterLiveDataAggregator", () => {
  it("counts a second's requests, failures and mean response time", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    aggregator.add(row({ startedAt: 100, elapsed: 100, allThreads: 5 }));
    aggregator.add(row({ startedAt: 200, elapsed: 200, allThreads: 5 }));
    aggregator.add(row({ startedAt: 300, elapsed: 300, success: false, allThreads: 5 }));
    aggregator.tick(SECOND + 3_000);

    expect(emitter.buckets).toEqual([
      {
        timestampMilliseconds: SECOND,
        virtualUsers: 5,
        successCount: 2,
        failureCount: 1,
        averageResponseTimeMilliseconds: 200,
      },
    ]);
  });

  // A row reaches the file when the sample finishes, so a request that started in
  // an already-emitted second still belongs to the second it completed in.
  // Bucketing on timeStamp would drop exactly the slow requests that matter most.
  it("buckets a request by when it completed, not when it started", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    // Starts 200ms into second 0, finishes 700ms into second 2.
    expect(aggregator.add(row({ startedAt: 200, elapsed: 2_500 }))).toBe(true);
    aggregator.tick(SECOND + 5_000);

    expect(emitter.buckets.map((bucket) => bucket.timestampMilliseconds)).toEqual([
      SECOND + 2_000,
      // Nothing before it: the first bucket is the first *completion*.
    ]);
    expect(emitter.buckets[0]?.successCount).toBe(1);
  });

  it("reports the peak thread count in the second, matching the final concurrency", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    aggregator.add(row({ startedAt: 100, elapsed: 10, allThreads: 12 }));
    aggregator.add(row({ startedAt: 200, elapsed: 10, allThreads: 40 }));
    aggregator.add(row({ startedAt: 300, elapsed: 10, allThreads: 8 }));
    aggregator.tick(SECOND + 3_000);

    expect(emitter.buckets[0]?.virtualUsers).toBe(40);
  });

  it("fills a quiet second with an empty bucket that keeps the thread count", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    aggregator.add(row({ startedAt: 100, elapsed: 10, allThreads: 7 }));
    aggregator.add(row({ startedAt: 2_100, elapsed: 10, allThreads: 7 }));
    aggregator.tick(SECOND + 5_000);

    expect(emitter.buckets).toEqual([
      {
        timestampMilliseconds: SECOND,
        virtualUsers: 7,
        successCount: 1,
        failureCount: 0,
        averageResponseTimeMilliseconds: 10,
      },
      {
        // No completions, but the threads are still there waiting on a slow
        // endpoint — reporting 0 users mid-test would be a lie.
        timestampMilliseconds: SECOND + 1_000,
        virtualUsers: 7,
        successCount: 0,
        failureCount: 0,
        averageResponseTimeMilliseconds: 0,
      },
      {
        timestampMilliseconds: SECOND + 2_000,
        virtualUsers: 7,
        successCount: 1,
        failureCount: 0,
        averageResponseTimeMilliseconds: 10,
      },
    ]);
  });

  it("holds a second back until it is old enough to be complete", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    aggregator.add(row({ startedAt: 100, elapsed: 10 }));

    // One millisecond short of the 2s hold: still too young to report.
    aggregator.tick(SECOND + 2_999);
    expect(emitter.buckets).toEqual([]);

    aggregator.tick(SECOND + 3_000);
    expect(emitter.buckets).toHaveLength(1);
  });

  // The worst case the hold has to cover: a request completing in the final
  // millisecond of a second, whose row is delayed by a GC pause or a stretched
  // poll. It gets the whole delay and no more, so this is the budget itself.
  it("still counts a row that arrives 1.9s after the request completed", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    // Completes at SECOND + 999; the tailer does not read it until +2,899.
    aggregator.tick(SECOND + 2_899);
    expect(aggregator.add(row({ startedAt: 989, elapsed: 10 }))).toBe(true);
    aggregator.tick(SECOND + 3_000);

    expect(emitter.buckets).toHaveLength(1);
    expect(emitter.buckets[0]).toMatchObject({ timestampMilliseconds: SECOND, successCount: 1 });
    expect(aggregator.droppedLateRowCount).toBe(0);
  });

  it("accepts a late-arriving row until its second has been emitted", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    aggregator.add(row({ startedAt: 100, elapsed: 10 }));
    expect(aggregator.add(row({ startedAt: 50, elapsed: 10 }))).toBe(true);
    aggregator.tick(SECOND + 3_000);

    expect(emitter.buckets[0]?.successCount).toBe(2);
    expect(aggregator.droppedLateRowCount).toBe(0);

    // Same second, but the watermark has passed it now.
    expect(aggregator.add(row({ startedAt: 900, elapsed: 10 }))).toBe(false);
    expect(aggregator.droppedLateRowCount).toBe(1);
    expect(emitter.buckets).toHaveLength(1);
  });

  it("emits the seconds still held when JMeter stops", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    aggregator.add(row({ startedAt: 100, elapsed: 10 }));
    aggregator.add(row({ startedAt: 1_100, elapsed: 10 }));
    aggregator.flush(SECOND + 1_200);

    expect(emitter.buckets.map((bucket) => bucket.timestampMilliseconds)).toEqual([SECOND, SECOND + 1_000]);
    expect(aggregator.emittedBucketCount).toBe(2);
  });

  it("emits nothing when no row ever arrived", () => {
    const emitter = makeEmitter();
    const aggregator = new JMeterLiveDataAggregator(emitter);

    aggregator.tick(SECOND + 5_000);
    aggregator.flush(SECOND + 5_000);

    expect(emitter.buckets).toEqual([]);
    expect(aggregator.emittedBucketCount).toBe(0);
  });
});
