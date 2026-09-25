// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { HistogramState } from "../schemas/result.ts";
import { findLatencyBucketIndex, getLatencyBucket, LATENCY_BUCKET_COUNT, MAX_LATENCY_US } from "./latency-layout.ts";
import { addSafeIntegers, assertPositiveSafeInteger, assertSafeNonnegativeInteger } from "./number-validation.ts";

/**
 * Estimated percentile value and the full bucket known to contain the exact
 * nearest-rank sample.
 */
export interface HistogramQuantile {
  /**
   * The bucket representative may sit outside the exact observed min/max.
   * Displayed percentiles must clamp this value to the distribution's exact
   * minUs and maxUs.
   */
  readonly estimateUs: number;
  readonly lowerUs: number;
  readonly upperUs: number;
}

/**
 * A histogram answers "how many full-request latencies fell in each range?"
 *
 * raw latencies             histogram counters
 * ---------------------     ----------------------------------------
 * 10, 11, 12 us        ->   10..12 us: 3
 * 20, 20 us            ->   20..21 us: 2
 *
 * We do not retain the five original values. This loses their exact position
 * inside a range, but the 0.5% layout keeps that range narrow enough to place
 * a strict bound on the reported value.
 *
 * latency                  stored as
 * ---------------------    -----------------------------------------
 * 0 us                     exact zero counter
 * 1 us through 24 hours    one of 2,184 fixed bucket counters
 *
 * `Float64Array` is a fixed-length row of eight-byte numbers. Unlike a normal
 * JavaScript array, it cannot grow. The total is checked before it reaches
 * JavaScript's exact-integer ceiling. No bucket can exceed that total, so its
 * count also remains exact.
 */
export class FixedLatencyHistogram {
  private readonly counts = new Float64Array(LATENCY_BUCKET_COUNT);
  private zeroCount = 0;
  private totalCount = 0;

  get count(): number {
    return this.totalCount;
  }

  /** Adds one latency or many repetitions of the same latency. */
  record(valueUs: number, weight = 1): void {
    /*
     * Weight records repeated equal values without a loop:
     *
     * record(20, 3) is the same as record(20), record(20), record(20)
     */
    if (!Number.isSafeInteger(valueUs) || valueUs < 0 || valueUs > MAX_LATENCY_US) {
      throw new RangeError(`latency must be an integer between 0 and ${MAX_LATENCY_US}.`);
    }
    assertPositiveSafeInteger(weight, "Histogram weight");
    this.totalCount = addSafeIntegers(this.totalCount, weight, "histogram count");

    if (valueUs === 0) {
      this.zeroCount += weight;
      return;
    }
    const index = findLatencyBucketIndex(valueUs);
    this.counts[index] = this.countAt(index) + weight;
  }

  /** Validates and adds saved histogram state. */
  merge(state: HistogramState): void {
    this.mergeValidated(validateHistogramState(state));
  }

  /** Adds histogram state that has already passed validateHistogramState. */
  mergeValidated(state: ValidatedHistogramState): void {
    this.totalCount = addSafeIntegers(this.totalCount, state.count, "histogram count");
    this.zeroCount += state.zeroCount;
    for (const [index, count] of state.bins) {
      this.counts[index] = this.countAt(index) + count;
    }
  }

  /**
   * Finds the nearest-rank percentile represented by numerator / denominator.
   *
   * quantile(99, 100) returns p99. Integer fractions avoid floating-point rank
   * errors for very large request counts.
   */
  quantile(numerator: number, denominator: number): HistogramQuantile {
    assertPositiveSafeInteger(numerator, "Quantile numerator");
    assertPositiveSafeInteger(denominator, "Quantile denominator");
    if (numerator > denominator) {
      throw new RangeError("Quantile must satisfy 0 < numerator <= denominator.");
    }
    if (this.totalCount === 0) throw new RangeError("Cannot query an empty histogram.");

    /*
     * Use nearest rank. With five values, p50 asks for item 3:
     *
     * ceil(50% * 5) = ceil(2.5) = 3
     *
     * State stays as numbers. This one query-time expression uses BigInt so
     * multiplying a large count by 999 cannot round across a rank boundary.
     */
    const rank = Number((BigInt(numerator) * BigInt(this.totalCount) + BigInt(denominator) - 1n) / BigInt(denominator));
    let cumulative = this.zeroCount;
    if (cumulative >= rank) return { estimateUs: 0, lowerUs: 0, upperUs: 0 };

    /*
     * Walk from fastest to slowest and keep a running count:
     *
     * bucket        count    running count
     * ---------     -----    -------------
     * 10..12 us       3            3
     * 20..21 us       2            5  <- rank 4 is in this bucket
     *
     * We return that bucket's estimate and bounds. We cannot identify the
     * original value inside the bucket because it was intentionally discarded.
     */
    for (let index = 0; index < LATENCY_BUCKET_COUNT; index += 1) {
      cumulative += this.countAt(index);
      if (cumulative >= rank) {
        const bucket = getLatencyBucket(index);
        return {
          estimateUs: bucket.representativeUs,
          lowerUs: bucket.lowerUs,
          upperUs: bucket.upperUs,
        };
      }
    }

    throw new Error("Histogram count invariant is broken.");
  }

  /** Converts fixed in-memory counters to sparse JSON-ready state. */
  snapshot(): HistogramState {
    /*
     * Memory uses all 2,184 counters for predictable size and fast updates.
     * JSON omits zero counters to keep result files small:
     *
     * memory: [0, 0, 5, 0, 2, 0]  ->  JSON: [[2, "5"], [4, "2"]]
     */
    const bins: (readonly [number, number])[] = [];
    for (let index = 0; index < LATENCY_BUCKET_COUNT; index += 1) {
      const count = this.countAt(index);
      if (count !== 0) bins.push([index, count]);
    }
    return {
      zeroCount: this.zeroCount,
      bins,
    };
  }

  /** Reads one fixed bucket and turns an impossible missing slot into an explicit error. */
  private countAt(index: number): number {
    const count = this.counts[index];
    if (count === undefined) throw new Error(`Missing histogram count at index ${index}.`);
    return count;
  }
}

/**
 * Histogram state after every count, index, ordering rule, and total has been
 * checked. The accumulator can merge this form without re-reading untrusted
 * JSON values.
 */
export interface ValidatedHistogramState {
  readonly zeroCount: number;
  readonly count: number;
  readonly bins: readonly (readonly [index: number, count: number])[];
}

/** Validates untrusted sparse histogram state before any merge occurs. */
export function validateHistogramState(state: HistogramState): ValidatedHistogramState {
  assertSafeNonnegativeInteger(state.zeroCount, "histogram zeroCount");
  const zeroCount = state.zeroCount;
  const bins: (readonly [number, number])[] = [];
  let count = zeroCount;
  let previousIndex = -1;

  for (const [index, rawCount] of state.bins) {
    if (!Number.isSafeInteger(index) || index <= previousIndex || index >= LATENCY_BUCKET_COUNT) {
      throw new TypeError("Histogram bins must have strictly increasing valid indexes.");
    }
    assertPositiveSafeInteger(rawCount, `histogram bin ${index}`);
    const binCount = rawCount;
    count = addSafeIntegers(count, binCount, "histogram count");
    bins.push([index, binCount]);
    previousIndex = index;
  }

  return {
    zeroCount,
    count,
    bins,
  };
}
