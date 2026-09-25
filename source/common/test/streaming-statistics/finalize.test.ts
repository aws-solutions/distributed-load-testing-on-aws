// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { finalizeResultState, ResultAccumulator } from "../../src/streaming-statistics/index.ts";

describe("finalizeResultState", () => {
  it("derives deterministic legacy display fields from merge state", () => {
    const accumulator = new ResultAccumulator();
    accumulator.recordCompletedRequest({
      label: "z",
      success: true,
      responseCode: "201",
      bytes: 100,
      latencyUs: 10_000,
      waitingTimeUs: 4_000,
      connectTimeUs: 1_000,
    });
    accumulator.recordCompletedRequest({
      label: "a",
      success: false,
      responseCode: "500",
      bytes: 20,
      latencyUs: 30_000,
      waitingTimeUs: 8_000,
    });
    accumulator.recordCompletedRequest({
      label: "",
      success: true,
      responseCode: "200",
      bytes: 5,
      latencyUs: 20_000,
    });

    const result = finalizeResultState(accumulator.snapshot(), {
      summaryConcurrency: 7,
      labelConcurrency: new Map([
        ["z", 2],
        ["a", 3],
        ["", 0],
      ]),
    });

    expect(result.summary).toMatchObject({
      label: "",
      successCount: 2,
      failureCount: 1,
      totalRequestCount: 3,
      concurrency: 7,
      totalBytesReceived: 125,
      averageResponseTimeMilliseconds: 20,
      averageLatencyMilliseconds: 6,
      averageConnectTimeMilliseconds: 1,
      minResponseTimeMilliseconds: 10,
      maxResponseTimeMilliseconds: 30,
      responseCodes: [
        { code: "200", count: 1 },
        { code: "201", count: 1 },
        { code: "500", count: 1 },
      ],
    });
    expect(result.summary.responseTimeStdDevMilliseconds).toBeCloseTo(Math.sqrt(200 / 3), 12);
    expect(result.summary.p50).toBeGreaterThanOrEqual(19.9);
    expect(result.summary.p50).toBeLessThanOrEqual(20.1);
    expect(result.labels.map((label) => label.label)).toEqual(["", "a", "z"]);
    expect(result.labels[1]).toMatchObject({
      totalRequestCount: 1,
      concurrency: 3,
      averageConnectTimeMilliseconds: 0,
    });
  });

  it("returns zero display statistics for an empty state", () => {
    const result = finalizeResultState(new ResultAccumulator().snapshot(), {
      summaryConcurrency: 0,
    });

    expect(result).toEqual({
      summary: {
        label: "",
        successCount: 0,
        failureCount: 0,
        totalRequestCount: 0,
        concurrency: 0,
        totalBytesReceived: 0,
        averageResponseTimeMilliseconds: 0,
        averageLatencyMilliseconds: 0,
        averageConnectTimeMilliseconds: 0,
        responseTimeStdDevMilliseconds: 0,
        minResponseTimeMilliseconds: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        p99_9: 0,
        maxResponseTimeMilliseconds: 0,
        responseCodes: [],
      },
      labels: [],
    });
  });

  it("rejects invalid concurrency", () => {
    expect(() => finalizeResultState(new ResultAccumulator().snapshot(), { summaryConcurrency: -1 })).toThrow(
      /concurrency/
    );
  });
});
