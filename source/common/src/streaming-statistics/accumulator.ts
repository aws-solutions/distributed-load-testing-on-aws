// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ResultAccumulatorState } from "../schemas/result.ts";
import { LATENCY_HISTOGRAM_LAYOUT_ID } from "../schemas/result.ts";
import { AggregateAccumulator } from "./aggregate-accumulator.ts";
import { validateResultState } from "./result-state-validation.ts";
import { compareUtf8 } from "./utf8.ts";

/**
 * One completed request from a framework parser.
 *
 * Latency is the full duration from request start through the complete
 * response. Waiting and connection time are optional. Waiting time keeps the
 * framework's own waiting/first-byte definition; it is not normalized across
 * frameworks.
 */
export interface CompletedRequestObservation {
  readonly label: string;
  readonly success: boolean;
  /** Framework-defined. An empty string means the framework reported no code. */
  readonly responseCode: string;
  readonly bytes: number;
  readonly latencyUs: number;
  readonly waitingTimeUs?: number;
  readonly connectTimeUs?: number;
}

/**
 * A batch form used when a parser already knows that many requests share the
 * same label and response code.
 */
export interface RequestCountObservation {
  readonly label: string;
  readonly count: number;
  readonly responseCode: string;
}

/** A batch of failures for one label. */
export interface CountObservation {
  readonly label: string;
  readonly count: number;
}

/** One timing value, optionally repeated many times, for one label. */
export interface TimingObservation {
  readonly label: string;
  readonly valueUs: number;
  /** Defaults to one. A larger value records repeated equal timings. */
  readonly count?: number;
}

/**
 * Routes observations into mergeable running totals.
 *
 *                         +------------------+
 * request --------------> | Overall          |
 *    |
 *    | label="checkout"    +------------------+
 *    `-------------------> | checkout         |
 *                         +------------------+
 *
 * Every request requires a customer label and is counted in both Overall and
 * that label. Overall is derived; callers never pass a special Overall label.
 *
 * `recordCompletedRequest` keeps all request counts aligned. The lower-level
 * batch methods may be called separately, but before `snapshot`:
 *
 * total requests = latency samples = all response-code counts
 * failures <= total requests
 * optional waiting/connect samples <= total requests
 *
 * `snapshot` throws instead of publishing a partial or contradictory result.
 *
 * Observed concurrency is not part of this state. Peaks measured independently
 * by each task cannot be added or maximized into the fleet's peak. That value
 * requires aligned samples across tasks.
 *
 * This class decides where values go. The other files own the details:
 *
 * file                          responsibility
 * --------------------------    -------------------------------------------
 * aggregate-accumulator.ts      stores one Overall or label total
 * result-state-validation.ts    checks a saved state before a merge
 * histogram.ts                  counts latencies in fixed ranges
 */
export class ResultAccumulator {
  private readonly labels = new Map<string, AggregateAccumulator>();
  private readonly summary = new AggregateAccumulator();

  /**
   * Records every statistic supplied for one finished request.
   *
   * Prefer this method when parsing request-by-request logs because it keeps
   * request, latency, failure, byte, and response-code totals aligned.
   */
  recordCompletedRequest(input: CompletedRequestObservation): void {
    this.summary.recordCompletedRequest(input);
    this.label(input.label).recordCompletedRequest(input);
  }

  /**
   * Adds request and response-code counts when a framework reports aggregates.
   *
   * This does not add latency, failure, or byte values. The parser must record
   * those separately before taking a snapshot.
   */
  recordRequestCount(input: RequestCountObservation): void {
    this.summary.recordRequestCount(input.count, input.responseCode);
    this.label(input.label).recordRequestCount(input.count, input.responseCode);
  }

  /** Adds failures reported separately from total request counts. */
  recordFailureCount(input: CountObservation): void {
    this.summary.recordFailureCount(input.count);
    this.label(input.label).recordFailureCount(input.count);
  }

  /**
   * Adds bytes that a framework reports only for the whole task.
   *
   * k6's `data_received` metric is the main example: it has an exact task total
   * but no dependable request label. Keeping it in Overall avoids inventing a
   * per-label allocation.
   */
  recordSummaryBytes(bytes: number): void {
    this.summary.recordBytes(bytes);
  }

  /** Adds full-request latency samples used for averages, deviation, and percentiles. */
  recordLatency(input: TimingObservation): void {
    const count = input.count ?? 1;
    this.summary.latency.record(input.valueUs, count);
    this.label(input.label).latency.record(input.valueUs, count);
  }

  /** Adds framework-defined waiting/first-byte samples used for the waiting-time average. */
  recordWaitingTime(input: TimingObservation): void {
    const count = input.count ?? 1;
    this.summary.waitingTime.record(input.valueUs, count);
    this.label(input.label).waitingTime.record(input.valueUs, count);
  }

  /** Adds connection-establishment samples used for the connect-time average. */
  recordConnectTime(input: TimingObservation): void {
    const count = input.count ?? 1;
    this.summary.connectTime.record(input.valueUs, count);
    this.label(input.label).connectTime.record(input.valueUs, count);
  }

  /**
   * Adds a saved task or reducer state into this accumulator.
   *
   * The complete input is validated before it is added.
   */
  merge(state: ResultAccumulatorState): void {
    const validatedState = validateResultState(state);
    this.summary.mergeValidated(validatedState.summary);
    for (const labelState of validatedState.labels) {
      this.label(labelState.label).mergeValidated(labelState.aggregate);
    }
  }

  /**
   * Returns deterministic JSON-ready state for storage or another reduction.
   *
   * Each metric stream is published as observed. Native results are
   * best-effort, so optional or framework-specific streams do not need to
   * agree before a snapshot can be saved.
   */
  snapshot(): ResultAccumulatorState {
    const summary = this.summary.snapshot();
    const labels = Array.from(this.labels, ([label, aggregate]) => ({
      label,
      ...aggregate.snapshot(),
    })).sort((left, right) => compareUtf8(left.label, right.label));

    return {
      histogramLayout: LATENCY_HISTOGRAM_LAYOUT_ID,
      summary,
      labels,
    };
  }

  private label(label: string): AggregateAccumulator {
    let aggregate = this.labels.get(label);
    if (aggregate === undefined) {
      aggregate = new AggregateAccumulator();
      this.labels.set(label, aggregate);
    }
    return aggregate;
  }
}
