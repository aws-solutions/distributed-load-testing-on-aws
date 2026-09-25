// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export { ResultAccumulator } from "./accumulator.ts";
export type {
  CompletedRequestObservation,
  CountObservation,
  RequestCountObservation,
  TimingObservation,
} from "./accumulator.ts";
export { finalizeResultState } from "./finalize.ts";
export {
  findLatencyBucketIndex,
  getLatencyBucket,
  LATENCY_BUCKET_COUNT,
  LATENCY_HISTOGRAM_BYTES,
  LATENCY_HISTOGRAM_LAYOUT_ID,
  LATENCY_LAYOUT_SHA256,
  LATENCY_RELATIVE_ERROR_DENOMINATOR,
  LATENCY_RELATIVE_ERROR_NUMERATOR,
  latencyLayoutCanonicalRows,
  MAX_LATENCY_US,
} from "./latency-layout.ts";
export type { LatencyBucket } from "./latency-layout.ts";
