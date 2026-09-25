// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Turns JMeter's JTL rows into the single live-data event DLT expects each second.
//
// A JTL row is a whole request — count, outcome, response time and thread count
// in one line — so a second's bucket is filled from complete samples.

import type { KpiRow } from "../results/reduce-kpi-rows.js";
import type { LiveDataEmitter } from "./emitter.js";

interface Bucket {
  requestCount: number;
  failureCount: number;
  responseTimeSum: number;
  /** Peak concurrency seen in this second, or undefined if no row reported it. */
  virtualUsers?: number;
}

// How long to hold a finished second before reporting it.
//
// This is the entire budget for a row to travel from "sample completed" to "in a
// bucket", and it is deliberately generous. Whatever misses that deadline is
// dropped from the live chart (it is still in the JTL, so the final result is
// not affected).
//
// flush() emits every held second once JMeter stops. Watch droppedLateRowCount in
// the runner's logs — a non-zero count on a real test means raise this.
const EMISSION_DELAY_MILLISECONDS = 2_000;

export class JMeterLiveDataAggregator {
  private readonly buckets = new Map<number, Bucket>();
  private nextSecond: number | undefined;
  private emittedThrough: number | undefined;
  private carriedVirtualUsers = 0;
  private emittedBuckets = 0;
  private droppedLateRows = 0;

  constructor(private readonly emitter: LiveDataEmitter) {}

  get emittedBucketCount(): number {
    return this.emittedBuckets;
  }

  get droppedLateRowCount(): number {
    return this.droppedLateRows;
  }

  /**
   * Adds one completed request. Returns false if its second has already been
   * emitted, which live data cannot revise — final reduction still reads the row
   * from the same file, so nothing is lost from the results.
   */
  add(row: KpiRow): boolean {
    // Bucketed by when the request finished, not when it started. A row only
    // reaches the file once the sample completes, so bucketing on timeStamp would
    // date every slow request to a second that has already been emitted and drop
    // it as late — the slower the endpoint, the more of the chart goes missing.
    const second = startOfSecond(row.timeStamp + row.elapsed);
    if (this.emittedThrough !== undefined && second <= this.emittedThrough) {
      this.droppedLateRows += 1;
      return false;
    }

    if (this.nextSecond === undefined || second < this.nextSecond) {
      this.nextSecond = second;
    }

    let bucket = this.buckets.get(second);
    if (bucket === undefined) {
      bucket = { requestCount: 0, failureCount: 0, responseTimeSum: 0 };
      this.buckets.set(second, bucket);
    }

    bucket.requestCount += 1;
    if (!row.success) bucket.failureCount += 1;
    bucket.responseTimeSum += row.elapsed;
    // Every row carries the engine-wide thread count, so take the peak within the
    // second. That matches the concurrency reduceKpiRows reports for the whole
    // run, which is also a maximum. True concurrency metrics are best effort since
    // the value may constantly fluctuate.
    if (bucket.virtualUsers === undefined || row.allThreads > bucket.virtualUsers) {
      bucket.virtualUsers = row.allThreads;
    }

    return true;
  }

  /** Emits every completed second that is old enough to be safely reported. */
  tick(nowMilliseconds: number): void {
    this.emitThrough(startOfSecond(nowMilliseconds - EMISSION_DELAY_MILLISECONDS) - 1_000);
  }

  /** Emits whatever is left once JMeter has stopped writing. */
  flush(nowMilliseconds: number): void {
    if (this.nextSecond === undefined) return;

    let lastSecond = startOfSecond(nowMilliseconds);
    for (const second of this.buckets.keys()) {
      lastSecond = Math.max(lastSecond, second);
    }
    this.emitThrough(lastSecond);
  }

  /**
   * Advances the live timeline one aligned second at a time. Seconds with no rows
   * still emit an empty bucket, so a quiet stretch reads as zero throughput
   * instead of leaving a hole in the chart.
   *
   * Emission commits the watermark: a row arriving later for that second is
   * dropped from live data, while final reduction still reads it from the JTL.
   */
  private emitThrough(lastSecond: number): void {
    while (this.nextSecond !== undefined && this.nextSecond <= lastSecond) {
      const second = this.nextSecond;
      const bucket = this.buckets.get(second);
      if (bucket?.virtualUsers !== undefined) {
        this.carriedVirtualUsers = bucket.virtualUsers;
      }

      const requestCount = bucket?.requestCount ?? 0;
      const failureCount = bucket?.failureCount ?? 0;

      this.emitter.emit({
        timestampMilliseconds: second,
        // A second with no completed requests says nothing about how many threads
        // are running, so carry the last count forward rather than reporting 0
        // users mid-test.
        virtualUsers: this.carriedVirtualUsers,
        successCount: requestCount - failureCount,
        failureCount,
        averageResponseTimeMilliseconds: requestCount === 0 ? 0 : (bucket?.responseTimeSum ?? 0) / requestCount,
      });

      this.buckets.delete(second);
      this.emittedThrough = second;
      this.nextSecond = second + 1_000;
      this.emittedBuckets += 1;
    }
  }
}

function startOfSecond(timestampMilliseconds: number): number {
  return Math.floor(timestampMilliseconds / 1_000) * 1_000;
}
