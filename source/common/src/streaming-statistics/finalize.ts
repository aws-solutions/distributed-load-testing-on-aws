// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DltResultV1, LabelAggregate, ResultAccumulatorState } from "../schemas/result.ts";
import { FixedLatencyHistogram } from "./histogram.ts";
import { assertFiniteNumberInRange } from "./number-validation.ts";
import { validateResultState, type ValidatedAggregateState } from "./result-state-validation.ts";
import { compareUtf8 } from "./utf8.ts";

/**
 * Validates mergeable statistics and converts them into the final `summary`
 * and `labels` fields of `DltResultV1`.
 *
 * Concurrency is supplied separately because `ResultAccumulatorState` does
 * not track it.
 */
export function finalizeResultState(
  state: ResultAccumulatorState,
  input: {
    readonly summaryConcurrency: number;
    readonly labelConcurrency?: ReadonlyMap<string, number>;
  }
): Pick<DltResultV1, "summary" | "labels"> {
  const validated = validateResultState(state);
  assertFiniteNumberInRange(input.summaryConcurrency, 0, Number.MAX_VALUE, "summary concurrency");
  const labels = validated.labels.map(({ label, aggregate }) => {
    const concurrency = input.labelConcurrency?.get(label) ?? 0;
    assertFiniteNumberInRange(concurrency, 0, Number.MAX_VALUE, `concurrency for label ${label}`);
    return finalizeAggregate(label, aggregate, concurrency);
  });
  labels.sort((left, right) => compareUtf8(left.label, right.label));

  return {
    summary: finalizeAggregate("", validated.summary, input.summaryConcurrency),
    labels,
  };
}

function finalizeAggregate(label: string, state: ValidatedAggregateState, concurrency: number): LabelAggregate {
  const latency = state.latency;
  // Rebuild the histogram from its saved buckets to calculate percentiles.
  const histogram = new FixedLatencyHistogram();
  histogram.mergeValidated(latency.histogram);

  // Existing result fields call full request time "response time" and
  // framework waiting/first-byte time "latency."
  return {
    label,
    successCount: state.requestCount - state.failureCount,
    failureCount: state.failureCount,
    totalRequestCount: state.requestCount,
    concurrency,
    totalBytesReceived: state.bytesReceived,
    averageResponseTimeMilliseconds: microsecondsToMilliseconds(latency.meanUs),
    averageLatencyMilliseconds: microsecondsToMilliseconds(state.waitingTime.meanUs),
    averageConnectTimeMilliseconds: microsecondsToMilliseconds(state.connectTime.meanUs),
    responseTimeStdDevMilliseconds: latency.count === 0 ? 0 : Math.sqrt(latency.m2UsSquared / latency.count) / 1_000,
    minResponseTimeMilliseconds: microsecondsToMilliseconds(latency.minUs),
    p50: percentileMilliseconds(histogram, latency.minUs, latency.maxUs, 1, 2),
    p90: percentileMilliseconds(histogram, latency.minUs, latency.maxUs, 9, 10),
    p95: percentileMilliseconds(histogram, latency.minUs, latency.maxUs, 95, 100),
    p99: percentileMilliseconds(histogram, latency.minUs, latency.maxUs, 99, 100),
    p99_9: percentileMilliseconds(histogram, latency.minUs, latency.maxUs, 999, 1_000),
    maxResponseTimeMilliseconds: microsecondsToMilliseconds(latency.maxUs),
    responseCodes: [...state.responseCodes].sort((left, right) => compareUtf8(left.code, right.code)),
  };
}

function percentileMilliseconds(
  histogram: FixedLatencyHistogram,
  minUs: number | null,
  maxUs: number | null,
  numerator: number,
  denominator: number
): number {
  if (minUs === null || maxUs === null) return 0;
  const estimateUs = histogram.quantile(numerator, denominator).estimateUs;
  // A bucket estimate can exceed the observed endpoints, so keep it inside them.
  return Math.min(Math.max(estimateUs, minUs), maxUs) / 1_000;
}

function microsecondsToMilliseconds(valueUs: number | null): number {
  return valueUs === null ? 0 : valueUs / 1_000;
}
