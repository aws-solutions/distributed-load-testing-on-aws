// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Schema for the per-second live-data stream that native-mode
 * load-tester containers emit on stdout. A CloudWatch Logs
 * subscription filter forwards matching lines to the
 * `real-time-data-publisher` Lambda, which republishes them on IoT
 * topic `dlt/{testId}` for the web UI to render real-time graphs.
 *
 * Wire format: one JSON object per line, terminated by a single `\n`,
 * one line per second per task. Lines MUST stay well under 1 KB and
 * MUST NOT contain embedded newlines so the Lambda can parse each
 * CloudWatch log event's message as one JSON object.
 *
 * Forward compatibility: consumers ignore unknown extra top-level
 * fields. Incompatible changes MUST bump the `schema` suffix
 * (`dlt.live-data.v2`) and ship a new subscription filter + Lambda.
 */

/** Literal schema identifier for the v1 live-data event format. */
export const LIVE_DATA_V1_SCHEMA = "dlt.live-data.v1" as const;

export interface LiveDataEvent {
  readonly schema: typeof LIVE_DATA_V1_SCHEMA;
  readonly testId: string;
  readonly region: string;
  /** Rounded to the start of the reported 1-second bucket. */
  readonly timestampMilliseconds: number;
  readonly virtualUsers: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly averageResponseTimeMilliseconds: number;
}
