// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export { LATENCY_HISTOGRAM_LAYOUT_ID } from "../schemas/result.ts";

export const LATENCY_RELATIVE_ERROR_NUMERATOR = 1;
export const LATENCY_RELATIVE_ERROR_DENOMINATOR = 200;
export const MAX_LATENCY_US = 86_400_000_000;
export const LATENCY_BUCKET_COUNT = 2_184;
export const LATENCY_HISTOGRAM_BYTES = LATENCY_BUCKET_COUNT * Float64Array.BYTES_PER_ELEMENT;
export const LATENCY_LAYOUT_SHA256 = "f4f2711a805b2fee2e607d6e93182be0d86b7ff9c93d99a2f23d75e4f2c40c53";

/**
 * One inclusive latency range and the single value reported for samples in it.
 *
 * lowerUs <= exact sample <= upperUs
 * reported percentile = representativeUs
 */
export interface LatencyBucket {
  readonly lowerUs: number;
  readonly upperUs: number;
  readonly representativeUs: number;
}

const LOWER_BOUNDS = new Float64Array(LATENCY_BUCKET_COUNT);
const UPPER_BOUNDS = new Float64Array(LATENCY_BUCKET_COUNT);
const REPRESENTATIVES = new Float64Array(LATENCY_BUCKET_COUNT);
let layoutGenerated = false;

/**
 * Serializes every bucket as stable text for cross-language compatibility tests.
 *
 * The buckets grow with the latency. A one-microsecond-wide bucket is
 * useful near zero but needlessly precise near an hour; a fixed percentage
 * gives roughly the same relative precision at both ends.
 *
 * Example shape only:
 *
 * time area       bucket width is roughly
 * ------------    -------------------------
 * 100 us          1 us
 * 100 ms          1 ms
 * 100 s           1 s
 *
 * The generated integer boundaries below are the exact contract. Every
 * runtime must build exactly the same table.
 *
 * lower bound    upper bound    value reported for the bucket
 * -----------    -----------    ---------------------------------
 * 1 us           1 us           1 us
 * ...            ...            ...
 * 86,041 s       86,400 s       86,400 s
 *
 * The final representative is capped at the 24-hour input ceiling. It remains
 * within 0.5% of the final bucket's lower edge and can be recorded again like
 * every other representative. Canonical rows are ASCII
 * `lower,upper,representative\n`; their SHA-256 catches layout drift between
 * languages before results are merged.
 */
export function latencyLayoutCanonicalRows(): string {
  ensureLayout();
  let rows = "";
  for (let index = 0; index < LATENCY_BUCKET_COUNT; index += 1) {
    rows += `${LOWER_BOUNDS[index]},${UPPER_BOUNDS[index]},${REPRESENTATIVES[index]}\n`;
  }
  return rows;
}

/** Returns the inclusive bounds and representative for one numbered bucket. */
export function getLatencyBucket(index: number): LatencyBucket {
  if (!Number.isInteger(index) || index < 0 || index >= LATENCY_BUCKET_COUNT) {
    throw new RangeError(`Latency bucket index must be between 0 and ${LATENCY_BUCKET_COUNT - 1}.`);
  }
  ensureLayout();
  return {
    lowerUs: typedArrayValue(LOWER_BOUNDS, index),
    upperUs: typedArrayValue(UPPER_BOUNDS, index),
    representativeUs: typedArrayValue(REPRESENTATIVES, index),
  };
}

/** Finds which positive-latency bucket contains an exact microsecond value. */
export function findLatencyBucketIndex(valueUs: number): number {
  if (!Number.isSafeInteger(valueUs) || valueUs <= 0 || valueUs > MAX_LATENCY_US) {
    throw new RangeError(`Positive latency must be between 1 and ${MAX_LATENCY_US} microseconds.`);
  }
  ensureLayout();

  /*
   * Binary search repeatedly discards half of the 2,184 buckets:
   *
   * all buckets -> upper/lower half -> half again -> matching bucket
   *
   * This takes at most about 12 comparisons instead of checking every bucket.
   */
  let low = 0;
  let high = LATENCY_BUCKET_COUNT - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (valueUs <= typedArrayValue(UPPER_BOUNDS, middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Delays table generation until streaming statistics actually need a bucket.
 *
 * The common package is also imported by Lambdas that never calculate latency
 * statistics. Those Lambdas should not allocate tables or risk an unrelated
 * layout error while their modules are loading.
 */
function ensureLayout(): void {
  if (layoutGenerated) return;
  generateLayout();
  layoutGenerated = true;
}

/**
 * Builds the immutable bucket table the first time a caller needs it.
 *
 * Each next bucket starts one microsecond after the previous upper edge, so
 * every positive latency through 24 hours belongs to exactly one bucket.
 */
function generateLayout(): void {
  let lowerUs = 1;
  let index = 0;

  while (lowerUs <= MAX_LATENCY_US) {
    if (index >= LATENCY_BUCKET_COUNT) {
      throw new Error(`Latency layout has more than ${LATENCY_BUCKET_COUNT} buckets.`);
    }

    /*
     * Starting from the lower edge, choose a reported value and upper edge
     * that stay within 0.5%:
     *
     * lower edge -> reported value -> upper edge -> next bucket
     *      L       floor(201L/200)   floor(200R/199)   U + 1
     */
    const representativeUs = Math.min(
      Math.floor(
        ((LATENCY_RELATIVE_ERROR_DENOMINATOR + LATENCY_RELATIVE_ERROR_NUMERATOR) * lowerUs) /
          LATENCY_RELATIVE_ERROR_DENOMINATOR
      ),
      MAX_LATENCY_US
    );
    const upperUs = Math.min(
      Math.floor(
        (LATENCY_RELATIVE_ERROR_DENOMINATOR * representativeUs) /
          (LATENCY_RELATIVE_ERROR_DENOMINATOR - LATENCY_RELATIVE_ERROR_NUMERATOR)
      ),
      MAX_LATENCY_US
    );
    LOWER_BOUNDS[index] = lowerUs;
    UPPER_BOUNDS[index] = upperUs;
    REPRESENTATIVES[index] = representativeUs;
    lowerUs = upperUs + 1;
    index += 1;
  }

  if (index !== LATENCY_BUCKET_COUNT) {
    throw new Error(`Latency layout generated ${index} buckets; expected ${LATENCY_BUCKET_COUNT}.`);
  }
}

/** Reads a generated table entry with an explicit guard for unchecked indexes. */
function typedArrayValue(values: Float64Array, index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing generated latency-layout value at index ${index}.`);
  return value;
}
