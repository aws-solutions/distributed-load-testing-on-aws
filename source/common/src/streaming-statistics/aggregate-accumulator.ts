// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { AggregateState, DistributionState, MeanState } from "../schemas/result.ts";
import type { CompletedRequestObservation } from "./accumulator.ts";
import { FixedLatencyHistogram } from "./histogram.ts";
import { mergeMeanMoments, mergeVarianceMoments } from "./moments.ts";
import {
  type ValidatedAggregateState,
  type ValidatedDistributionState,
  type ValidatedMeanState,
} from "./result-state-validation.ts";
import { compareUtf8 } from "./utf8.ts";
import { addNonnegativeIntegers, addSafeIntegers } from "./number-validation.ts";

/*
 * An aggregate is one row of statistics: either Overall or one label.
 *
 * AggregateAccumulator
 * |-- requests: total and failures
 * |-- bytes received
 * |-- response codes: "200" -> count, "500" -> count
 * |-- latency: mean, variance state, range, and histogram
 * |-- waiting time: count + mean
 * `-- connect time: count + mean
 *
 * We keep a histogram only for latency because that is the timing shown in
 * latency profiles and percentile results.
 */
export class AggregateAccumulator {
  readonly latency = new DistributionAccumulator();
  readonly waitingTime = new MeanAccumulator("waiting time");
  readonly connectTime = new MeanAccumulator("connect time");
  private readonly responseCodes = new Map<string, number>();
  private requestCount = 0;
  private failureCount = 0;
  private bytesReceived = 0;

  /** Adds one completed request from a framework parser. */
  recordCompletedRequest(input: CompletedRequestObservation): void {
    this.latency.record(input.latencyUs, 1);
    if (input.waitingTimeUs !== undefined) this.waitingTime.record(input.waitingTimeUs, 1);
    if (input.connectTimeUs !== undefined) this.connectTime.record(input.connectTimeUs, 1);
    this.recordRequestCount(1, input.responseCode);
    if (!input.success) this.recordFailureCount(1);
    this.recordBytes(input.bytes);
  }

  /** Adds request and response-code counts reported by a framework parser. */
  recordRequestCount(count: number, responseCode: string): void {
    this.requestCount += count;
    this.responseCodes.set(responseCode, (this.responseCodes.get(responseCode) ?? 0) + count);
  }

  /** Adds failures reported by a framework parser. */
  recordFailureCount(count: number): void {
    this.failureCount += count;
  }

  /** Adds bytes reported by a framework parser. */
  recordBytes(bytes: number): void {
    this.bytesReceived += bytes;
  }

  /** Adds saved state after its structure and individual values have been validated. */
  mergeValidated(state: ValidatedAggregateState): void {
    this.requestCount = addSafeIntegers(this.requestCount, state.requestCount, "request count");
    this.failureCount = addSafeIntegers(this.failureCount, state.failureCount, "failure count");
    this.bytesReceived = addNonnegativeIntegers(this.bytesReceived, state.bytesReceived, "bytes received");
    this.latency.mergeValidated(state.latency);
    this.waitingTime.mergeValidated(state.waitingTime);
    this.connectTime.mergeValidated(state.connectTime);
    for (const responseCode of state.responseCodes) {
      this.responseCodes.set(
        responseCode.code,
        addSafeIntegers(
          this.responseCodes.get(responseCode.code) ?? 0,
          responseCode.count,
          `response code ${responseCode.code}`
        )
      );
    }
  }

  /** Returns this row as deterministic JSON-ready merge state. */
  snapshot(): AggregateState {
    if (this.failureCount > this.requestCount) {
      throw new TypeError("Failure count must not exceed request count.");
    }
    const successCount = this.requestCount - this.failureCount;
    const responseCodes = Array.from(this.responseCodes, ([code, count]) => ({
      code,
      count,
    })).sort((left, right) => compareUtf8(left.code, right.code));

    return {
      requests: {
        total: this.requestCount,
        success: successCount,
        failure: this.failureCount,
      },
      bytesReceived: this.bytesReceived,
      latency: this.latency.snapshot(),
      waitingTime: this.waitingTime.snapshot(),
      connectTime: this.connectTime.snapshot(),
      responseCodes,
    };
  }
}

/*
 * "Distribution" means we need averages, deviation, endpoints, and percentiles.
 *
 * input values: 10, 20, 30 us
 *
 * stored field       value       what it later answers
 * ----------------   --------    -------------------------------
 * count              3           how many values?
 * mean               20          average
 * M2                 200         standard deviation
 * min / max          10 / 30     exact endpoints
 * histogram          3 counters  p50, p90, p99, ...
 *
 * M2 adds each value's squared distance from the mean:
 *
 * (10 - 20)^2 + (20 - 20)^2 + (30 - 20)^2 = 200
 * population variance = M2 / count
 *
 * Welford updates this state as observations arrive. Chan's formula combines
 * two such states, so task, shard, regional, and final reducers never need the
 * original latency list.
 */
class DistributionAccumulator {
  private histogram: FixedLatencyHistogram | undefined;
  private sampleCount = 0;
  private meanUs: number | null = null;
  private m2UsSquared = 0;
  private minUs: number | null = null;
  private maxUs: number | null = null;

  /** Adds a repeated latency using a weighted Welford update. */
  record(valueUs: number, count: number): void {
    this.histogram ??= new FixedLatencyHistogram();
    this.histogram.record(valueUs, count);

    const previousCount = this.sampleCount;
    const nextCount = previousCount + count;
    const previousMean = this.meanUs;
    if (previousMean === null) {
      this.meanUs = valueUs;
    } else {
      const delta = valueUs - previousMean;
      this.meanUs = previousMean + (delta * count) / nextCount;
      this.m2UsSquared += (delta * delta * previousCount * count) / nextCount;
    }
    this.sampleCount = nextCount;
    this.minUs = this.minUs === null || valueUs < this.minUs ? valueUs : this.minUs;
    this.maxUs = this.maxUs === null || valueUs > this.maxUs ? valueUs : this.maxUs;
  }

  /** Adds validated distribution state with Chan's parallel-variance formula. */
  mergeValidated(state: ValidatedDistributionState): void {
    const sampleCount = addSafeIntegers(this.sampleCount, state.count, "latency count");
    const merged = mergeVarianceMoments(
      { count: this.sampleCount, meanUs: this.meanUs, m2UsSquared: this.m2UsSquared },
      state
    );
    if ((merged.meanUs !== null && !Number.isFinite(merged.meanUs)) || !Number.isFinite(merged.m2UsSquared)) {
      throw new RangeError("Merged latency moments must remain finite.");
    }
    this.sampleCount = sampleCount;
    this.meanUs = merged.meanUs;
    this.m2UsSquared = merged.m2UsSquared;
    if (state.minUs !== null) this.minUs = this.minUs === null ? state.minUs : Math.min(this.minUs, state.minUs);
    if (state.maxUs !== null) this.maxUs = this.maxUs === null ? state.maxUs : Math.max(this.maxUs, state.maxUs);
    if (state.count > 0) {
      this.histogram ??= new FixedLatencyHistogram();
      this.histogram.mergeValidated(state.histogram);
    }
  }

  /** Returns mergeable moments, exact endpoints, and sparse histogram counters. */
  snapshot(): DistributionState {
    return {
      count: this.sampleCount,
      meanUs: this.meanUs,
      m2UsSquared: this.m2UsSquared,
      minUs: this.minUs,
      maxUs: this.maxUs,
      histogram: this.histogram?.snapshot() ?? emptyHistogramState(),
    };
  }
}

/*
 * Waiting and connect time need only a count and weighted mean. Waiting time
 * retains each framework's
 * own definition and should not be compared across frameworks:
 *
 * task A: mean 50, count 2
 * task B: mean 9, count 100
 * merged: (50*2 + 9*100) / 102, not average(50, 9)
 */
class MeanAccumulator {
  private readonly name: string;
  private sampleCount = 0;
  private meanUs: number | null = null;

  constructor(name: string) {
    this.name = name;
  }

  /** Adds a repeated timing value to the weighted mean. */
  record(valueUs: number, count: number): void {
    const nextCount = this.sampleCount + count;
    const previousMean = this.meanUs;
    this.meanUs = previousMean === null ? valueUs : previousMean + ((valueUs - previousMean) * count) / nextCount;
    this.sampleCount = nextCount;
  }

  /** Adds validated timing state to the weighted mean. */
  mergeValidated(state: ValidatedMeanState): void {
    const sampleCount = addSafeIntegers(this.sampleCount, state.count, `${this.name} count`);
    const merged = mergeMeanMoments({ count: this.sampleCount, meanUs: this.meanUs }, state);
    if (merged.meanUs !== null && !Number.isFinite(merged.meanUs)) {
      throw new RangeError(`Merged ${this.name} mean must remain finite.`);
    }
    this.sampleCount = sampleCount;
    this.meanUs = merged.meanUs;
  }

  /** Returns the mergeable count and weighted mean. */
  snapshot(): MeanState {
    return { count: this.sampleCount, meanUs: this.meanUs };
  }
}

/** Returns the saved histogram form used before any positive latency is recorded. */
function emptyHistogramState(): DistributionState["histogram"] {
  return {
    zeroCount: 0,
    bins: [],
  };
}
