// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Schema for the per-task result artifact that native-mode
 * load-tester containers upload to S3 at end-of-test. The
 * `results-parser` Lambda consumes one file per task, aggregates
 * per-region and per-total, and writes the existing Scenarios +
 * History DynamoDB rows.
 *
 * S3 layout: `s3://{bucket}/results/{testId}/{prefix}/{region}/{taskId}/result.json`.
 * One `DltResultV1` JSON object per file.
 *
 * Forward compatibility: consumers ignore unknown extra top-level
 * fields. Incompatible changes MUST bump the `schema` suffix
 * (`dlt.result.v2`) and ship a new Lambda that recognises it.
 */

/** Literal schema identifier for the v1 per-task result artifact. */
export const DLT_RESULT_V1_SCHEMA = "dlt.result.v1" as const;
export const LATENCY_HISTOGRAM_LAYOUT_ID = "dlt.latency-us.rel-0p5pct.0-24h.v1" as const;

/** Complete result artifact uploaded by each native-mode load-test task. */
export interface DltResultV1 {
  readonly schema: typeof DLT_RESULT_V1_SCHEMA;
  readonly testId: string;
  readonly taskId: string;
  readonly region: string;
  /** ISO-8601. */
  readonly startTime: string;
  /** ISO-8601. */
  readonly endTime: string;
  readonly testDurationSeconds: number;
  readonly task: TaskMetadata;
  /** Test-level aggregate across all labels. */
  readonly summary: LabelAggregate;
  readonly labels: readonly LabelAggregate[];
  /** Task statistics that can be combined without losing accuracy. */
  readonly statistics: ResultAccumulatorState;
}

/** ECS capacity and runtime used by the task. */
export interface TaskMetadata {
  readonly vcpus: number;
  readonly memoryMiB: number;
  readonly ecsDurationSeconds: number;
}

/** Final display values for Overall or one customer-defined request label. */
export interface LabelAggregate {
  /** Transaction or endpoint label; empty string for the test-level summary. */
  readonly label: string;
  readonly successCount: number;
  readonly failureCount: number;
  /** successCount + failureCount. */
  readonly totalRequestCount: number;
  /** Max observed concurrent virtual users during sampling. */
  readonly concurrency: number;
  readonly totalBytesReceived: number;
  readonly averageResponseTimeMilliseconds: number;
  readonly averageLatencyMilliseconds: number;
  readonly averageConnectTimeMilliseconds: number;
  readonly responseTimeStdDevMilliseconds: number;
  readonly minResponseTimeMilliseconds: number;
  /** Percentile response times in milliseconds. */
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly p99_9: number;
  readonly maxResponseTimeMilliseconds: number;
  readonly responseCodes: readonly ResponseCodeCount[];
}

/** Final request count for one framework-defined response code. */
export interface ResponseCodeCount {
  /**
   * Framework-defined identifier. Typically a numeric HTTP status
   * code as a string ("200", "404"). On network-level failures the
   * value is framework-specific — JMeter emits a text string
   * (e.g. "Non HTTP response code: java.net.ConnectException"),
   * k6 emits a numeric error code ("1100", "1300"), and Locust
   * surfaces exception class names.
   */
  readonly code: string;
  readonly count: number;
}

/*
 * Mergeable statistics carried by dlt.result.v1 through every reduction level.
 *
 * task states -> final total -> displayed statistics
 *
 * Counts and histogram ranks stay exact within JavaScript's safe-integer
 * range. Means and variance use mergeable floating-point state so reducers do
 * not retain individual observations.
 */

/** Sparse JSON form of one fixed-size latency histogram. */
export interface HistogramState {
  readonly zeroCount: number;
  /** Sorted by bucket number. Empty buckets are left out. */
  readonly bins: readonly (readonly [index: number, count: number])[];
}

/**
 * Mergeable statistics for full-request latency.
 *
 * field           meaning                              used for
 * -------------   ----------------------------------   ---------------------
 * count           number of responses                  weighting/validation
 * meanUs          running average                      final average
 * m2UsSquared     sum of squared distances from mean   standard deviation
 * minUs / maxUs   actual smallest/largest time         exact endpoints
 * histogram       counts in fixed ranges               bounded percentiles
 *
 * Population variance is m2UsSquared / count. Welford updates and Chan merges
 * keep this stable without saving every latency or subtracting two enormous
 * raw sums.
 */
export interface DistributionState {
  readonly count: number;
  readonly meanUs: number | null;
  readonly m2UsSquared: number;
  readonly minUs: number | null;
  readonly maxUs: number | null;
  readonly histogram: HistogramState;
}

/**
 * Mergeable average for an optional timing such as waiting or connect time.
 */
export interface MeanState {
  /** Number of requests that reported this optional timing. */
  readonly count: number;
  /** Null only when count is zero. */
  readonly meanUs: number | null;
}

/** Mergeable request count for one framework-defined response code. */
export interface ResponseCodeState {
  /** Empty means the framework reported no response code. */
  readonly code: string;
  readonly count: number;
}

/**
 * All mergeable statistics for one row: either Overall or one request label.
 *
 * AggregateState
 * |-- request and byte counts
 * |-- latency distribution, including percentile buckets
 * |-- waiting/connect values needed for averages
 * `-- response-code counts
 *
 * This is saved between reduction levels. It does not contain calculated
 * averages, standard deviation, or percentiles.
 */
export interface AggregateState {
  readonly requests: {
    readonly total: number;
    readonly success: number;
    readonly failure: number;
  };
  /**
   * Byte telemetry is exact through Number.MAX_SAFE_INTEGER and may round by a
   * few bytes for multi-petabyte totals.
   */
  readonly bytesReceived: number;
  /** Full request duration, from request start through the complete response. */
  readonly latency: DistributionState;
  /** Framework-specific waiting or first-byte timing; not comparable across all frameworks. */
  readonly waitingTime: MeanState;
  readonly connectTime: MeanState;
  readonly responseCodes: readonly ResponseCodeState[];
}

/** One customer-defined label plus all statistics collected for that label. */
export interface LabelState extends AggregateState {
  readonly label: string;
}

/**
 * Complete mergeable state for one task, region, or final reduction level.
 *
 * summary receives every request. labels splits those same requests by their
 * customer-defined labels.
 */
export interface ResultAccumulatorState {
  /** Applies to the summary and every label histogram in this result. */
  readonly histogramLayout: typeof LATENCY_HISTOGRAM_LAYOUT_ID;
  readonly summary: AggregateState;
  /** Sorted by the UTF-8 bytes of each label. */
  readonly labels: readonly LabelState[];
}
