// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ResultAccumulator, LATENCY_HISTOGRAM_LAYOUT_ID } from "../../src/streaming-statistics/index.ts";

describe("ResultAccumulator", () => {
  it("records mergeable moments, counts, means, codes, and sparse labels", () => {
    const accumulator = new ResultAccumulator();
    accumulator.recordCompletedRequest({
      label: "checkout",
      success: true,
      responseCode: "200",
      bytes: 512,
      latencyUs: 10_000,
      waitingTimeUs: 8_000,
      connectTimeUs: 2_000,
    });
    accumulator.recordCompletedRequest({
      label: "checkout",
      success: false,
      responseCode: "500",
      bytes: 128,
      latencyUs: 30_000,
      waitingTimeUs: 20_000,
    });

    const state = accumulator.snapshot();
    expect(state.histogramLayout).toBe(LATENCY_HISTOGRAM_LAYOUT_ID);
    expect(state.summary).toMatchObject({
      requests: { total: 2, success: 1, failure: 1 },
      bytesReceived: 640,
      latency: {
        count: 2,
        meanUs: 20_000,
        m2UsSquared: 200_000_000,
        minUs: 10_000,
        maxUs: 30_000,
      },
      waitingTime: { count: 2, meanUs: 14_000 },
      connectTime: { count: 1, meanUs: 2_000 },
      responseCodes: [
        { code: "200", count: 1 },
        { code: "500", count: 1 },
      ],
    });
    expect(state.labels).toHaveLength(1);
    expect(state.labels[0]).toMatchObject({ label: "checkout", requests: state.summary.requests });
  });

  it("keeps counts exact through the JavaScript safe-integer boundary", () => {
    const accumulator = makeShard("exact", Number.MAX_SAFE_INTEGER, 1);
    const before = accumulator.snapshot();

    expect(before.summary).toMatchObject({
      requests: {
        total: Number.MAX_SAFE_INTEGER,
        success: Number.MAX_SAFE_INTEGER,
        failure: 0,
      },
      latency: {
        count: Number.MAX_SAFE_INTEGER,
        meanUs: 1,
        m2UsSquared: 0,
      },
      responseCodes: [{ code: "200", count: Number.MAX_SAFE_INTEGER }],
    });
    expect(() => {
      accumulator.recordCompletedRequest({
        label: "exact",
        success: true,
        responseCode: "200",
        bytes: 0,
        latencyUs: 1,
      });
    }).toThrow(/exact integer range/);
    expect(accumulator.snapshot()).toEqual(before);
  });

  it("allows approximate byte telemetry beyond the safe-integer boundary", () => {
    const accumulator = makeShard("download", 1, 1);
    const multiPetabyteTotal = Number.MAX_SAFE_INTEGER + 1;
    accumulator.recordSummaryBytes(multiPetabyteTotal);
    accumulator.recordSummaryBytes(2);

    expect(accumulator.snapshot().summary.bytesReceived).toBe(multiPetabyteTotal + 2);
  });

  it("keeps framework-wide bytes in Overall without inventing per-label bytes", () => {
    const accumulator = makeShard("k6 request", 2, 1);
    accumulator.recordSummaryBytes(150);

    const state = accumulator.snapshot();
    expect(state.summary.bytesReceived).toBe(150);
    expect(state.labels[0]?.bytesReceived).toBe(0);

    const merged = new ResultAccumulator();
    expect(() => merged.merge(state)).not.toThrow();
    expect(merged.snapshot().summary.bytesReceived).toBe(150);
  });

  it("merges uneven partitions with negligible floating-point drift", () => {
    const shards = [makeShard("a", 1, 10), makeShard("b", 1_000, 20), makeShard("a", 3, 30)];

    const left = new ResultAccumulator();
    for (const shard of shards) left.merge(shard.snapshot());

    const partial = new ResultAccumulator();
    partial.merge(requiredAt(shards, 2).snapshot());
    partial.merge(requiredAt(shards, 0).snapshot());
    const other = new ResultAccumulator();
    other.merge(requiredAt(shards, 1).snapshot());
    const tree = new ResultAccumulator();
    tree.merge(other.snapshot());
    tree.merge(partial.snapshot());

    const leftState = left.snapshot();
    const treeState = tree.snapshot();
    expect(treeState.summary.requests).toEqual(leftState.summary.requests);
    expect(treeState.summary.latency.histogram).toEqual(leftState.summary.latency.histogram);
    expect(treeState.summary.latency.meanUs).toBeCloseTo(leftState.summary.latency.meanUs as number, 12);
    expect(treeState.summary.latency.m2UsSquared).toBeCloseTo(leftState.summary.latency.m2UsSquared, 8);
  });

  it("keeps Welford variance stable at a large latency baseline", () => {
    const accumulator = new ResultAccumulator();
    const count = 5_000_000;
    accumulator.recordRequestCount({ label: "tail", count: count * 2, responseCode: "200" });
    accumulator.recordLatency({ label: "tail", valueUs: 1_000_000_000 - 1, count });
    accumulator.recordLatency({ label: "tail", valueUs: 1_000_000_000 + 1, count });

    const latency = accumulator.snapshot().summary.latency;
    expect(latency.meanUs).toBe(1_000_000_000);
    expect(latency.m2UsSquared / latency.count).toBe(1);
  });

  it("round-trips a high-baseline distribution with a tiny variance", () => {
    const source = new ResultAccumulator();
    source.recordRequestCount({ label: "round-trip", count: 1_001, responseCode: "200" });
    source.recordLatency({ label: "round-trip", valueUs: 1_000_000_000, count: 1_000 });
    source.recordLatency({ label: "round-trip", valueUs: 1_000_000_001 });

    const target = new ResultAccumulator();
    expect(() => target.merge(source.snapshot())).not.toThrow();
    expect(target.snapshot()).toEqual(source.snapshot());
  });

  it("round-trips a reducer-scale weighted distribution with one rare value", () => {
    const source = new ResultAccumulator();
    source.recordRequestCount({ label: "rare", count: 10_000_000_001, responseCode: "200" });
    source.recordLatency({ label: "rare", valueUs: 38 });
    source.recordLatency({ label: "rare", valueUs: 0, count: 10_000_000_000 });

    const state = source.snapshot();
    const target = new ResultAccumulator();
    expect(() => target.merge(state)).not.toThrow();
    expect(target.snapshot()).toEqual(state);
  });

  it("canonicalizes Overall moments from interleaved label batches", () => {
    const source = new ResultAccumulator();
    source.recordRequestCount({ label: "a", count: 4_650_000, responseCode: "200" });
    source.recordRequestCount({ label: "b", count: 4_650_000, responseCode: "200" });
    source.recordLatency({ label: "a", valueUs: 1_000_000_000, count: 3_100_000 });
    source.recordLatency({ label: "b", valueUs: 1_000_000_001, count: 3_100_000 });
    source.recordLatency({ label: "a", valueUs: 1_000_000_002, count: 1_550_000 });
    source.recordLatency({ label: "b", valueUs: 1_000_000_003, count: 1_550_000 });

    const state = source.snapshot();
    const target = new ResultAccumulator();
    expect(() => target.merge(state)).not.toThrow();
    expect(target.snapshot()).toEqual(state);
  });

  it("calculates unequal weighted moments against a known result", () => {
    const accumulator = new ResultAccumulator();
    accumulator.recordRequestCount({ label: "weighted", count: 3, responseCode: "200" });
    accumulator.recordLatency({ label: "weighted", valueUs: 10, count: 2 });
    accumulator.recordLatency({ label: "weighted", valueUs: 30 });

    const latency = accumulator.snapshot().summary.latency;
    expect(latency.meanUs).toBeCloseTo(50 / 3, 12);
    expect(latency.m2UsSquared).toBeCloseTo(800 / 3, 12);
  });

  it("sorts labels and response codes by UTF-8 bytes", () => {
    const accumulator = new ResultAccumulator();
    for (const [label, code] of [
      ["z", "500"],
      ["é", "404"],
      ["a", "200"],
    ] as const) {
      accumulator.recordCompletedRequest({
        label,
        success: code === "200",
        responseCode: code,
        bytes: 0,
        latencyUs: 1,
      });
    }

    expect(accumulator.snapshot().labels.map((item) => item.label)).toEqual(["a", "z", "é"]);
    expect(accumulator.snapshot().summary.responseCodes.map((item) => item.code)).toEqual(["200", "404", "500"]);
  });

  it('treats "overall" as a customer label while deriving summary separately', () => {
    const accumulator = new ResultAccumulator();
    accumulator.recordCompletedRequest({
      label: "overall",
      success: true,
      responseCode: "200",
      bytes: 1,
      latencyUs: 10,
    });

    const state = accumulator.snapshot();
    expect(state.summary.requests.total).toBe(1);
    expect(state.labels).toHaveLength(1);
    expect(state.labels[0]).toMatchObject({
      label: "overall",
      requests: { total: 1 },
    });
  });

  it("does not impose product limits on labels or response codes", () => {
    const accumulator = new ResultAccumulator();
    for (let index = 0; index < 65; index += 1) {
      accumulator.recordCompletedRequest({
        label: "many-codes",
        success: true,
        responseCode: `code-${index}`,
        bytes: 0,
        latencyUs: 1,
      });
    }
    accumulator.recordCompletedRequest({
      label: "l".repeat(300),
      success: true,
      responseCode: "c".repeat(100),
      bytes: 0,
      latencyUs: 1,
    });

    const state = accumulator.snapshot();
    expect(state.labels).toHaveLength(2);
    expect(state.summary.responseCodes).toHaveLength(66);
  });

  it("rejects merge count overflow", () => {
    const target = makeShard("only", Number.MAX_SAFE_INTEGER, 0);
    const incoming = makeShard("only", 1, 0);

    expect(() => {
      target.merge(incoming.snapshot());
    }).toThrow(/exact integer range/);
  });

  it("rejects nonnumeric and fractional count fields before merging", () => {
    const target = new ResultAccumulator();
    const valid = makeShard("only", 2, 1).snapshot();
    const nonnumeric = {
      ...valid,
      summary: {
        ...valid.summary,
        requests: {
          ...valid.summary.requests,
          total: "2" as unknown as number,
        },
      },
    };
    expect(() => target.merge(nonnumeric)).toThrow(/safe integer/);

    const fractional = {
      ...valid,
      summary: {
        ...valid.summary,
        requests: {
          ...valid.summary.requests,
          total: 2.5,
        },
      },
    };
    expect(() => target.merge(fractional)).toThrow(/safe integer/);
    expect(target.snapshot().summary.requests.total).toBe(0);
  });

  it("rejects duplicate labels because they target the same accumulator", () => {
    const state = makeShard("duplicate", 1, 1).snapshot();
    const duplicated = {
      ...state,
      labels: [state.labels[0] as (typeof state.labels)[number], state.labels[0] as (typeof state.labels)[number]],
    };

    expect(() => new ResultAccumulator().merge(duplicated)).toThrow(/Labels must be unique/);
  });

  it("rejects a merge that would make floating moments infinite", () => {
    const state = makeShard("large-moment", 1, 1).snapshot();
    const withLargestMoment = {
      ...state,
      summary: {
        ...state.summary,
        latency: { ...state.summary.latency, m2UsSquared: Number.MAX_VALUE },
      },
      labels: state.labels.map((label) => ({
        ...label,
        latency: { ...label.latency, m2UsSquared: Number.MAX_VALUE },
      })),
    };
    const target = new ResultAccumulator();
    target.merge(withLargestMoment);

    expect(() => target.merge(withLargestMoment)).toThrow(/remain finite/);
  });

  it("rejects non-finite or negative moments that would poison later merges", () => {
    const target = new ResultAccumulator();
    const valid = makeMixedShard().snapshot();
    const negativeM2 = {
      ...valid,
      summary: {
        ...valid.summary,
        latency: {
          ...valid.summary.latency,
          m2UsSquared: -1,
        },
      },
    };
    expect(() => target.merge(negativeM2)).toThrow(/M2/);

    const infiniteMean = {
      ...valid,
      summary: {
        ...valid.summary,
        latency: {
          ...valid.summary.latency,
          meanUs: Number.POSITIVE_INFINITY,
        },
      },
    };
    expect(() => target.merge(infiniteMean)).toThrow(/mean/);
    expect(target.snapshot().summary.requests.total).toBe(0);
  });

  it("accepts individually safe moments without proving their statistical relationships", () => {
    const source = makeMixedShard().snapshot();
    const bestEffort = {
      ...source,
      summary: {
        ...source.summary,
        latency: {
          ...source.summary.latency,
          meanUs: 0.75,
          m2UsSquared: 10,
        },
      },
    };
    const target = new ResultAccumulator();

    expect(() => target.merge(bestEffort)).not.toThrow();
    expect(target.snapshot().summary.latency).toMatchObject({
      meanUs: 0.75,
      m2UsSquared: 10,
    });
  });

  it("accepts safe Overall values without reconciling them against labels", () => {
    const source = new ResultAccumulator();
    source.recordCompletedRequest({
      label: "download",
      success: true,
      responseCode: "200",
      bytes: 10,
      latencyUs: 1,
    });
    const state = source.snapshot();
    const bestEffort = {
      ...state,
      summary: {
        ...state.summary,
        bytesReceived: 5,
      },
      labels: makeShard("different", 2, 2).snapshot().labels,
    };
    const target = new ResultAccumulator();

    expect(() => target.merge(bestEffort)).not.toThrow();
    expect(target.snapshot()).toMatchObject({
      summary: {
        requests: { total: 1 },
        bytesReceived: 5,
      },
      labels: [{ label: "different", requests: { total: 2 } }],
    });
  });

  it("keeps an empty response code when a framework reports no code", () => {
    const accumulator = new ResultAccumulator();
    accumulator.recordCompletedRequest({
      label: "network failure",
      success: false,
      responseCode: "",
      bytes: 0,
      latencyUs: 1,
    });

    expect(accumulator.snapshot().summary.responseCodes).toEqual([{ code: "", count: 1 }]);
  });

  it("does not publish an internally inconsistent metric stream", () => {
    const accumulator = new ResultAccumulator();
    accumulator.recordFailureCount({ label: "broken", count: 1 });

    expect(() => accumulator.snapshot()).toThrow(/Failure count/);
  });
});

function makeShard(label: string, count: number, latencyUs: number): ResultAccumulator {
  const accumulator = new ResultAccumulator();
  accumulator.recordRequestCount({ label, count, responseCode: "200" });
  accumulator.recordLatency({ label, valueUs: latencyUs, count });
  return accumulator;
}

function makeMixedShard(): ResultAccumulator {
  const accumulator = new ResultAccumulator();
  accumulator.recordCompletedRequest({
    label: "mixed",
    success: true,
    responseCode: "200",
    bytes: 0,
    latencyUs: 0,
  });
  accumulator.recordCompletedRequest({
    label: "mixed",
    success: true,
    responseCode: "200",
    bytes: 0,
    latencyUs: 1,
  });
  return accumulator;
}

function requiredAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Missing test item at index ${index}.`);
  return item;
}
