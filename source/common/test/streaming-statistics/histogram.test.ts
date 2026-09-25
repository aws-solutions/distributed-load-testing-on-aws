// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { findLatencyBucketIndex, MAX_LATENCY_US } from "../../src/streaming-statistics/index.ts";
import { FixedLatencyHistogram } from "../../src/streaming-statistics/histogram.ts";

describe("FixedLatencyHistogram", () => {
  it("records sparse exact counts and uses nearest-rank quantiles", () => {
    const histogram = new FixedLatencyHistogram();
    histogram.record(0, 2);
    histogram.record(100);
    histogram.record(1_000, 2);

    expect(histogram.count).toBe(5);
    expect(histogram.snapshot()).toEqual({
      zeroCount: 2,
      bins: [
        [findLatencyBucketIndex(100), 1],
        [findLatencyBucketIndex(1_000), 2],
      ],
    });
    expect(histogram.quantile(2, 5)).toEqual({ estimateUs: 0, lowerUs: 0, upperUs: 0 });
    const median = histogram.quantile(1, 2);
    expect(median.lowerUs).toBeLessThanOrEqual(100);
    expect(median.upperUs).toBeGreaterThanOrEqual(100);
    const maximumRank = histogram.quantile(1, 1);
    expect(maximumRank.lowerUs).toBeLessThanOrEqual(1_000);
    expect(maximumRank.upperUs).toBeGreaterThanOrEqual(1_000);
  });

  it("merges to the same state for different tree shapes", () => {
    const states = [1, 10, 100, 1_000, MAX_LATENCY_US].map((value) => {
      const histogram = new FixedLatencyHistogram();
      histogram.record(value);
      return histogram.snapshot();
    });

    const left = new FixedLatencyHistogram();
    for (const state of states) left.merge(state);

    const firstHalf = new FixedLatencyHistogram();
    for (const state of states.slice(0, 2)) firstHalf.merge(state);
    const secondHalf = new FixedLatencyHistogram();
    for (const state of states.slice(2)) secondHalf.merge(state);
    const balanced = new FixedLatencyHistogram();
    balanced.merge(secondHalf.snapshot());
    balanced.merge(firstHalf.snapshot());

    expect(balanced.snapshot()).toEqual(left.snapshot());
  });

  it("records weighted observations identically to explicit repetition", () => {
    const weighted = new FixedLatencyHistogram();
    weighted.record(123_456, 100);
    const repeated = new FixedLatencyHistogram();
    for (let index = 0; index < 100; index += 1) repeated.record(123_456);

    expect(weighted.snapshot()).toEqual(repeated.snapshot());
  });

  it("rejects count overflow without mutation", () => {
    const histogram = new FixedLatencyHistogram();
    histogram.record(1, Number.MAX_SAFE_INTEGER);
    const before = histogram.snapshot();

    expect(() => {
      histogram.record(1);
    }).toThrow(/exact integer range/);
    expect(histogram.snapshot()).toEqual(before);
  });

  it.each([
    ["uniform", Array.from({ length: 1_000 }, (_, index) => index + 1)],
    ["bimodal", [...Array<number>(900).fill(10_000), ...Array<number>(100).fill(1_000_000)]],
    ["tail jump", [...Array<number>(999).fill(1_000), 10_000_000]],
    ["zero-heavy", [...Array<number>(900).fill(0), ...Array<number>(100).fill(500)]],
  ])("contains exact nearest-rank values for the %s profile", (_name, values) => {
    const histogram = new FixedLatencyHistogram();
    for (const value of values) histogram.record(value);
    const sorted = values.toSorted((left, right) => left - right);

    for (const [numerator, denominator] of [
      [1, 2],
      [9, 10],
      [95, 100],
      [99, 100],
      [999, 1_000],
    ] as const) {
      const rank = Math.ceil((numerator * sorted.length) / denominator);
      const exact = requiredAt(sorted, rank - 1);
      const result = histogram.quantile(numerator, denominator);
      expect(result.lowerUs).toBeLessThanOrEqual(exact);
      expect(result.upperUs).toBeGreaterThanOrEqual(exact);
      if (exact > 0) {
        const error = Math.abs(result.estimateUs - exact);
        expect(error * 200).toBeLessThanOrEqual(exact);
      }
    }
  });

  it("rejects malformed states without mutation", () => {
    const histogram = new FixedLatencyHistogram();
    histogram.record(100);
    const before = histogram.snapshot();

    expect(() => {
      histogram.merge({
        zeroCount: 0,
        bins: [
          [4, 1],
          [4, 1],
        ],
      });
    }).toThrow(/strictly increasing/);
    expect(histogram.snapshot()).toEqual(before);
  });

  it("rejects invalid updates without mutation", () => {
    const histogram = new FixedLatencyHistogram();
    histogram.record(1);
    const before = histogram.snapshot();

    expect(() => histogram.record(-1)).toThrow(RangeError);
    expect(() => histogram.record(MAX_LATENCY_US + 1)).toThrow(RangeError);
    expect(() => histogram.record(1.5)).toThrow(RangeError);
    expect(() => histogram.record(1, 0)).toThrow(RangeError);
    expect(histogram.snapshot()).toEqual(before);
  });
});

function requiredAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Missing test item at index ${index}.`);
  return item;
}
