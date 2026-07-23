// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Schema for the per-task result artifact that native-mode
 * load-tester containers upload to S3 at end-of-test. The
 * `results-parser` Lambda consumes one file per task, aggregates
 * per-region and per-total, and writes the existing Scenarios +
 * History DynamoDB rows.
 *
 * S3 layout: `s3://{bucket}/results/{testId}/{prefix}/{taskId}-{region}.json`.
 * One `DltResultV1` JSON object per file.
 *
 * Forward compatibility: consumers ignore unknown extra top-level
 * fields. Incompatible changes MUST bump the `schema` suffix
 * (`dlt.result.v2`) and ship a new Lambda that recognises it.
 */

/** Literal schema identifier for the v1 per-task result artifact. */
export const DLT_RESULT_V1_SCHEMA = "dlt.result.v1" as const;

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
}

export interface TaskMetadata {
  readonly vcpus: number;
  readonly memoryMiB: number;
  readonly ecsDurationSeconds: number;
}

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
