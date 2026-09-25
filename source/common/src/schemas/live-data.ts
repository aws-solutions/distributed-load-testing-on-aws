// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

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
export const LIVE_DATA_V1_SCHEMA = "dlt.live-data.v1";

/**
 * Literal that satisfies the CloudWatch Logs subscription filter
 * `FilterPattern.allTerms("INFO: Current:", "live=true")` in
 * `infrastructure/lib/testing-resources/real-time-data.ts`. Emitting it as a
 * field value lets JSON lines reuse the existing filter, which matches raw
 * substrings and does not switch to JSON-aware matching.
 *
 * Case and spacing are load-bearing — the filter is case sensitive and each
 * quoted term must appear verbatim.
 */
export const LIVE_DATA_FILTER_MARKER = "INFO: Current: live=true";

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

/**
 * The on-the-wire form of {@link LiveDataEvent}: one JSON object per stdout
 * line. Field names are abbreviated and `avgRt` is in SECONDS, matching the
 * shape the `real-time-data-publisher` Lambda already republishes on IoT for
 * the Taurus-format path used by Standard mode.
 *
 * Produced by `load-tester/src/live-data/emitter.ts` and, for Locust, by
 * `load-tester/src/locust/sidecar.py`.
 */
const nonBlankString = z.string().refine((value) => value.trim().length > 0);
const nonnegativeInteger = z.number().int().nonnegative();

const liveDataPointSchema = z.object({
  schema: z.literal(LIVE_DATA_V1_SCHEMA),
  /** Always {@link LIVE_DATA_FILTER_MARKER}. */
  _filter: z.literal(LIVE_DATA_FILTER_MARKER),
  testId: nonBlankString,
  region: nonBlankString,
  /** Unix milliseconds at the start of the reported 1-second bucket. */
  timestamp: nonnegativeInteger.multipleOf(1000),
  vu: nonnegativeInteger,
  succ: nonnegativeInteger,
  fail: nonnegativeInteger,
  /** Average response time in SECONDS. */
  avgRt: z.number().nonnegative(),
});

export type LiveDataPoint = Readonly<z.infer<typeof liveDataPointSchema>>;

/**
 * Validates one CloudWatch log message as a live-data wire object.
 *
 * Returns the values exactly as they arrived — no unit conversion.
 *
 * Never throws: anything that isn't a well-formed `dlt.live-data.v1` object
 * yields `undefined` so the caller can apply its own error policy.
 */
export function parseLiveDataPoint(message: string): LiveDataPoint | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }

  const result = liveDataPointSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}
