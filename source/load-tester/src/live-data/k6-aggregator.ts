// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Turns k6's independent metric Points into the one HTTP-shaped live-data
// event DLT expects each second.
//
// k6 does not attach a request ID, so request totals, failures, and response
// times cannot be joined into complete request rows. We aggregate each metric
// independently, just as the final reducer does:
//   http_reqs          total requests
//   http_req_failed    failed requests (0 or 1 per sample)
//   http_req_duration  response time in milliseconds
//   vus                current active-VU gauge
//
// Other protocol metrics remain in kpi.json but have no dlt.live-data.v1
// meaning today.

import type { LiveDataEmitter } from "./emitter.js";

export interface K6LiveDataPoint {
  readonly metric: string;
  readonly timestampMilliseconds: number;
  readonly value: number;
}

interface Bucket {
  requestCount: number;
  failureCount: number;
  responseTimeSum: number;
  responseTimeCount: number;
  virtualUsers?: {
    readonly timestampMilliseconds: number;
    readonly value: number;
  };
}

// k6 flushes output roughly every 200 ms and the tailer polls every 250 ms.
// Waiting 500 ms after a second ends keeps normal write lag from looking late.
const EMISSION_DELAY_MILLISECONDS = 500;

export class K6LiveDataAggregator {
  private readonly buckets = new Map<number, Bucket>();
  private nextSecond: number | undefined;
  private emittedThrough: number | undefined;
  private carriedVirtualUsers = 0;
  private emittedBuckets = 0;
  private droppedLatePoints = 0;

  constructor(private readonly emitter: LiveDataEmitter) {}

  get emittedBucketCount(): number {
    return this.emittedBuckets;
  }

  get droppedLatePointCount(): number {
    return this.droppedLatePoints;
  }

  /**
   * Adds a supported metric Point. Returns false for metrics that live data
   * does not understand; the raw Point is still preserved in kpi.json.
   */
  add(point: K6LiveDataPoint): boolean {
    if (
      point.metric !== "http_reqs" &&
      point.metric !== "http_req_failed" &&
      point.metric !== "http_req_duration" &&
      point.metric !== "vus"
    ) {
      return false;
    }

    const second = startOfSecond(point.timestampMilliseconds);
    if (this.emittedThrough !== undefined && second <= this.emittedThrough) {
      this.droppedLatePoints += 1;
      return true;
    }

    if (this.nextSecond === undefined || second < this.nextSecond) {
      this.nextSecond = second;
    }

    let bucket = this.buckets.get(second);
    if (bucket === undefined) {
      bucket = newBucket();
      this.buckets.set(second, bucket);
    }

    switch (point.metric) {
      case "http_reqs":
        bucket.requestCount += point.value;
        break;
      case "http_req_failed":
        bucket.failureCount += point.value;
        break;
      case "http_req_duration":
        bucket.responseTimeSum += point.value;
        bucket.responseTimeCount += 1;
        break;
      case "vus":
        // Out-of-order Points can arrive before the watermark. Keep the latest
        // gauge sample from this second rather than whichever line we read last.
        if (
          bucket.virtualUsers === undefined ||
          point.timestampMilliseconds >= bucket.virtualUsers.timestampMilliseconds
        ) {
          bucket.virtualUsers = {
            timestampMilliseconds: point.timestampMilliseconds,
            value: point.value,
          };
        }
        break;
    }

    return true;
  }

  /** Emits every completed second that is old enough to be safely reported. */
  tick(nowMilliseconds: number): void {
    const lastCompleteSecond = startOfSecond(nowMilliseconds - EMISSION_DELAY_MILLISECONDS) - 1_000;
    this.emitThrough(lastCompleteSecond);
  }

  /** Emits the current second immediately after k6 has stopped writing. */
  flush(nowMilliseconds: number): void {
    if (this.nextSecond === undefined) return;

    let lastSecond = startOfSecond(nowMilliseconds);
    for (const second of this.buckets.keys()) {
      lastSecond = Math.max(lastSecond, second);
    }
    this.emitThrough(lastSecond);
  }

  /**
   * Advances the live timeline one aligned second at a time. Seconds with no
   * Points still emit an empty bucket so the chart does not show a gap.
   *
   * Emission commits the watermark: a Point arriving later for that second is
   * dropped from live data, while final reduction still reads it from kpi.json.
   */
  private emitThrough(lastSecond: number): void {
    while (this.nextSecond !== undefined && this.nextSecond <= lastSecond) {
      const second = this.nextSecond;
      const bucket = this.buckets.get(second);
      if (bucket?.virtualUsers !== undefined) {
        this.carriedVirtualUsers = bucket.virtualUsers.value;
      }

      const requestCount = bucket?.requestCount ?? 0;
      // A partial write can leave a failure Point without its request Point.
      const failureCount = Math.min(bucket?.failureCount ?? 0, requestCount);

      this.emitter.emit({
        timestampMilliseconds: second,
        virtualUsers: this.carriedVirtualUsers,
        successCount: requestCount - failureCount,
        failureCount,
        averageResponseTimeMilliseconds:
          bucket === undefined || bucket.responseTimeCount === 0
            ? 0
            : bucket.responseTimeSum / bucket.responseTimeCount,
      });

      this.buckets.delete(second);
      this.emittedThrough = second;
      this.nextSecond = second + 1_000;
      this.emittedBuckets += 1;
    }
  }
}

function newBucket(): Bucket {
  return {
    requestCount: 0,
    failureCount: 0,
    responseTimeSum: 0,
    responseTimeCount: 0,
  };
}

function startOfSecond(timestampMilliseconds: number): number {
  return Math.floor(timestampMilliseconds / 1_000) * 1_000;
}
