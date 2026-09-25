// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { parseLiveDataPoint } from "@amzn/dlt-common";
import type { MockInstance } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { K6LiveDataAggregator } from "../../src/live-data/k6-aggregator.js";
import { createLiveDataEmitter, type LiveDataBucket, type LiveDataEmitter } from "../../src/live-data/emitter.js";

const SECOND = 1_700_000_000_000;

type StdoutWriteSpy = MockInstance<typeof process.stdout.write>;

function makeEmitter(): LiveDataEmitter & { readonly buckets: LiveDataBucket[] } {
  const buckets: LiveDataBucket[] = [];
  return {
    buckets,
    emit(bucket) {
      buckets.push(bucket);
    },
  };
}

function point(metric: string, offsetMilliseconds: number, value: number) {
  return {
    metric,
    timestampMilliseconds: SECOND + offsetMilliseconds,
    value,
  };
}

describe("K6LiveDataAggregator", () => {
  let stdoutSpy: StdoutWriteSpy | undefined;

  afterEach(() => {
    stdoutSpy?.mockRestore();
    stdoutSpy = undefined;
  });

  it("counts requests and failures from their separate metric values", () => {
    const emitter = makeEmitter();
    const aggregator = new K6LiveDataAggregator(emitter);

    aggregator.add(point("vus", 100, 5));
    aggregator.add(point("http_reqs", 200, 2));
    aggregator.add(point("http_req_failed", 300, 0));
    aggregator.add(point("http_req_failed", 400, 1));
    aggregator.add(point("http_req_duration", 500, 100));
    aggregator.add(point("http_req_duration", 600, 200));
    aggregator.tick(SECOND + 1_500);

    expect(emitter.buckets).toEqual([
      {
        timestampMilliseconds: SECOND,
        virtualUsers: 5,
        successCount: 1,
        failureCount: 1,
        averageResponseTimeMilliseconds: 150,
      },
    ]);
  });

  it("emits exact wire objects for active, idle, and final seconds", () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const emitter = createLiveDataEmitter({ enabled: true, testId: "test-123", region: "us-east-1" });
    const aggregator = new K6LiveDataAggregator(emitter);

    aggregator.add(point("vus", 100, 4));
    aggregator.add(point("http_reqs", 200, 1));
    aggregator.add(point("http_req_failed", 300, 0));
    aggregator.add(point("http_req_duration", 400, 100));
    aggregator.add(point("http_reqs", 2_100, 1));
    aggregator.add(point("http_req_failed", 2_200, 1));
    aggregator.add(point("http_req_duration", 2_300, 300));
    aggregator.flush(SECOND + 2_400);

    const lines = stdoutSpy.mock.calls.map((call) => String(call[0]).trim());
    expect(lines.map((line) => parseLiveDataPoint(line))).toEqual([
      {
        schema: "dlt.live-data.v1",
        _filter: "INFO: Current: live=true",
        testId: "test-123",
        region: "us-east-1",
        timestamp: SECOND,
        vu: 4,
        succ: 1,
        fail: 0,
        avgRt: 0.1,
      },
      {
        schema: "dlt.live-data.v1",
        _filter: "INFO: Current: live=true",
        testId: "test-123",
        region: "us-east-1",
        timestamp: SECOND + 1_000,
        vu: 4,
        succ: 0,
        fail: 0,
        avgRt: 0,
      },
      {
        schema: "dlt.live-data.v1",
        _filter: "INFO: Current: live=true",
        testId: "test-123",
        region: "us-east-1",
        timestamp: SECOND + 2_000,
        vu: 4,
        succ: 0,
        fail: 1,
        avgRt: 0.3,
      },
    ]);
  });

  it("accepts out-of-order points until their second has been emitted", () => {
    const emitter = makeEmitter();
    const aggregator = new K6LiveDataAggregator(emitter);

    aggregator.add(point("http_reqs", 1_100, 1));
    aggregator.add(point("http_reqs", 100, 1));
    aggregator.flush(SECOND + 1_500);

    expect(emitter.buckets.map((bucket) => bucket.successCount)).toEqual([1, 1]);
    expect(aggregator.droppedLatePointCount).toBe(0);

    aggregator.add(point("http_reqs", 200, 1));

    expect(aggregator.droppedLatePointCount).toBe(1);
    expect(aggregator.emittedBucketCount).toBe(2);
  });

  it("ignores metrics that have no dlt.live-data.v1 meaning", () => {
    const emitter = makeEmitter();
    const aggregator = new K6LiveDataAggregator(emitter);

    expect(aggregator.add(point("ws_sessions", 0, 1))).toBe(false);
    aggregator.flush(SECOND);

    expect(emitter.buckets).toEqual([]);
  });
});
