// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  AggregateState,
  DistributionState,
  MeanState,
  ResultAccumulatorState,
  ResponseCodeState,
} from "../schemas/result.ts";
import { LATENCY_HISTOGRAM_LAYOUT_ID } from "../schemas/result.ts";
import { validateHistogramState, type ValidatedHistogramState } from "./histogram.ts";
import { MAX_LATENCY_US } from "./latency-layout.ts";
import {
  assertFiniteNumberInRange,
  assertNonnegativeInteger,
  assertSafeNonnegativeInteger,
} from "./number-validation.ts";
import { assertWellFormedString } from "./utf8.ts";

/*
 * This is a narrow safety boundary for task and reducer artifacts.
 *
 * It rejects values that cannot be merged safely: incompatible histogram
 * layouts, rounded counts, non-finite numbers, malformed buckets, and
 * duplicate labels. It deliberately does not prove that independently
 * reported metrics describe exactly the same requests. Native results are
 * best-effort, and those deeper relationships are covered by producer tests.
 */

/** Numeric latency state that is safe for an accumulator to merge. */
export interface ValidatedDistributionState {
  readonly count: number;
  readonly meanUs: number | null;
  readonly m2UsSquared: number;
  readonly minUs: number | null;
  readonly maxUs: number | null;
  readonly histogram: ValidatedHistogramState;
}

/** Numeric optional-timing state that is safe for an accumulator to merge. */
export interface ValidatedMeanState {
  readonly count: number;
  readonly meanUs: number | null;
}

/** One Overall or label row after its individual fields have been checked. */
export interface ValidatedAggregateState {
  readonly requestCount: number;
  readonly failureCount: number;
  readonly bytesReceived: number;
  readonly latency: ValidatedDistributionState;
  readonly waitingTime: ValidatedMeanState;
  readonly connectTime: ValidatedMeanState;
  readonly responseCodes: readonly { readonly code: string; readonly count: number }[];
}

/** Complete merge input after every row has passed the safety checks. */
export interface ValidatedResultState {
  readonly summary: ValidatedAggregateState;
  readonly labels: readonly {
    readonly label: string;
    readonly aggregate: ValidatedAggregateState;
  }[];
}

/**
 * Checks an untrusted task or reducer artifact before any destination changes.
 *
 * Label order is normalized again by `snapshot`; only duplicates are unsafe
 * because two entries would otherwise target the same accumulator.
 */
export function validateResultState(state: ResultAccumulatorState): ValidatedResultState {
  const layout: unknown = state.histogramLayout;
  if (layout !== LATENCY_HISTOGRAM_LAYOUT_ID) {
    throw new TypeError(`Result histogram layout must be ${LATENCY_HISTOGRAM_LAYOUT_ID}; received ${String(layout)}.`);
  }

  const labels: ValidatedResultState["labels"][number][] = [];
  const seenLabels = new Set<string>();
  for (const label of state.labels) {
    assertWellFormedString(label.label, "Label", true);
    if (seenLabels.has(label.label)) throw new TypeError("Labels must be unique.");
    seenLabels.add(label.label);
    labels.push({ label: label.label, aggregate: validateAggregateState(label) });
  }

  return {
    summary: validateAggregateState(state.summary),
    labels,
  };
}

/** Checks the standalone fields that are copied into one accumulator row. */
function validateAggregateState(state: AggregateState): ValidatedAggregateState {
  assertSafeNonnegativeInteger(state.requests.total, "request count");
  assertSafeNonnegativeInteger(state.requests.success, "success count");
  assertSafeNonnegativeInteger(state.requests.failure, "failure count");
  assertNonnegativeInteger(state.bytesReceived, "bytes received");
  if (state.requests.failure > state.requests.total) {
    throw new TypeError("Failure count must not exceed request count.");
  }

  return {
    requestCount: state.requests.total,
    failureCount: state.requests.failure,
    bytesReceived: state.bytesReceived,
    latency: validateDistributionState(state.latency),
    waitingTime: validateMeanState(state.waitingTime, "waiting time"),
    connectTime: validateMeanState(state.connectTime, "connect time"),
    responseCodes: validateResponseCodes(state.responseCodes),
  };
}

/**
 * Checks the fields needed to merge latency moments and query its histogram.
 *
 * Histogram count must equal distribution count because percentile ranks use
 * that count. No relationship to request or label counts is required.
 */
function validateDistributionState(state: DistributionState): ValidatedDistributionState {
  assertSafeNonnegativeInteger(state.count, "latency count");
  const histogram = validateHistogramState(state.histogram);
  if (histogram.count !== state.count) {
    throw new TypeError("Latency histogram count must equal distribution count.");
  }

  if (state.count === 0) {
    if (state.meanUs !== null || state.m2UsSquared !== 0 || state.minUs !== null || state.maxUs !== null) {
      throw new TypeError("An empty latency distribution requires a null mean, zero M2, and null extrema.");
    }
    return {
      count: 0,
      meanUs: null,
      m2UsSquared: 0,
      minUs: null,
      maxUs: null,
      histogram,
    };
  }

  if (state.meanUs === null || state.minUs === null || state.maxUs === null) {
    throw new TypeError("A non-empty latency distribution requires meanUs, minUs, and maxUs.");
  }
  assertFiniteNumberInRange(state.meanUs, 0, MAX_LATENCY_US, "latency mean");
  assertFiniteNumberInRange(state.m2UsSquared, 0, Number.MAX_VALUE, "latency M2");
  assertLatencyEndpoint(state.minUs, "latency min");
  assertLatencyEndpoint(state.maxUs, "latency max");
  if (state.minUs > state.maxUs) throw new TypeError("Latency minUs must not exceed maxUs.");
  if (state.meanUs < state.minUs || state.meanUs > state.maxUs) {
    throw new TypeError("Latency meanUs must fall between minUs and maxUs.");
  }

  return {
    count: state.count,
    meanUs: state.meanUs,
    m2UsSquared: state.m2UsSquared,
    minUs: state.minUs,
    maxUs: state.maxUs,
    histogram,
  };
}

/** Checks one framework-defined timing average without comparing it to requests. */
function validateMeanState(state: MeanState, name: string): ValidatedMeanState {
  assertSafeNonnegativeInteger(state.count, `${name} count`);
  if (state.count === 0) {
    if (state.meanUs !== null) throw new TypeError(`An empty ${name} state must have a null mean.`);
    return { count: 0, meanUs: null };
  }
  if (state.meanUs === null) throw new TypeError(`A non-empty ${name} state requires a mean.`);
  assertFiniteNumberInRange(state.meanUs, 0, MAX_LATENCY_US, `${name} mean`);
  return { count: state.count, meanUs: state.meanUs };
}

/** Checks response-code entries individually without reconciling their total. */
function validateResponseCodes(
  responseCodes: readonly ResponseCodeState[]
): readonly { readonly code: string; readonly count: number }[] {
  return responseCodes.map((item) => {
    assertWellFormedString(item.code, "Response code", true);
    assertSafeNonnegativeInteger(item.count, `response code ${item.code}`);
    if (item.count === 0) throw new TypeError("Sparse response-code entries must not have a zero count.");
    return { code: item.code, count: item.count };
  });
}

/** Requires an integer-microsecond endpoint inside the histogram layout. */
function assertLatencyEndpoint(value: unknown, field: string): asserts value is number {
  assertSafeNonnegativeInteger(value, field);
  if (value > MAX_LATENCY_US) throw new RangeError(`${field} must not exceed ${MAX_LATENCY_US}.`);
}
