// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  findLatencyBucketIndex,
  getLatencyBucket,
  LATENCY_BUCKET_COUNT,
  LATENCY_HISTOGRAM_BYTES,
  LATENCY_LAYOUT_SHA256,
  latencyLayoutCanonicalRows,
  MAX_LATENCY_US,
} from "../../src/streaming-statistics/index.ts";

describe("0.5% latency layout", () => {
  it("has the immutable count, size, range, and content hash", () => {
    expect(LATENCY_BUCKET_COUNT).toBe(2_184);
    expect(LATENCY_HISTOGRAM_BYTES).toBe(17_472);
    expect(getLatencyBucket(0)).toEqual({ lowerUs: 1, upperUs: 1, representativeUs: 1 });
    expect(getLatencyBucket(LATENCY_BUCKET_COUNT - 1)).toEqual({
      lowerUs: 86_041_275_475,
      upperUs: MAX_LATENCY_US,
      representativeUs: MAX_LATENCY_US,
    });
    expect(createHash("sha256").update(latencyLayoutCanonicalRows()).digest("hex")).toBe(LATENCY_LAYOUT_SHA256);
  });

  it("is contiguous and keeps both endpoints within 0.5% of the representative", () => {
    let expectedLower = 1;
    for (let index = 0; index < LATENCY_BUCKET_COUNT; index += 1) {
      const bucket = getLatencyBucket(index);
      expect(bucket.lowerUs).toBe(expectedLower);
      expect(withinRelativeError(bucket.representativeUs, bucket.lowerUs)).toBe(true);
      expect(withinRelativeError(bucket.representativeUs, bucket.upperUs)).toBe(true);
      expect(bucket.representativeUs).toBeLessThanOrEqual(MAX_LATENCY_US);
      expect(findLatencyBucketIndex(bucket.lowerUs)).toBe(index);
      expect(findLatencyBucketIndex(bucket.upperUs)).toBe(index);
      expect(findLatencyBucketIndex(bucket.representativeUs)).toBe(index);
      expectedLower = bucket.upperUs + 1;
    }
    expect(expectedLower).toBe(MAX_LATENCY_US + 1);
  });

  it("rejects zero, fractions, values above 24 hours, and invalid indexes", () => {
    expect(() => findLatencyBucketIndex(0)).toThrow(RangeError);
    expect(() => findLatencyBucketIndex(1.5)).toThrow(RangeError);
    expect(() => findLatencyBucketIndex(MAX_LATENCY_US + 1)).toThrow(RangeError);
    expect(() => getLatencyBucket(-1)).toThrow(RangeError);
    expect(() => getLatencyBucket(LATENCY_BUCKET_COUNT)).toThrow(RangeError);
  });
});

function withinRelativeError(representative: number, value: number): boolean {
  return Math.abs(representative - value) * 200 <= value;
}
