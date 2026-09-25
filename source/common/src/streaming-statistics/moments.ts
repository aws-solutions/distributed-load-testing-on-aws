// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Count and weighted mean for a possibly empty set of observations. */
export interface MeanMoments {
  readonly count: number;
  /** Null means count is zero. */
  readonly meanUs: number | null;
}

/**
 * Count, mean, and M2 for a possibly empty latency distribution.
 *
 * M2 is the sum of every value's squared distance from the mean:
 *
 * values:  10, 20, 30
 * mean:            20
 * M2:     100 + 0 + 100 = 200
 *
 * population variance = M2 / count
 */
export interface VarianceMoments extends MeanMoments {
  readonly m2UsSquared: number;
}

/**
 * Combines two weighted means without constructing large raw sums.
 *
 * A repeated value is represented as `{ count: repetitions, meanUs: value }`,
 * so the same operation handles individual observations, batches, and reducer
 * artifacts.
 */
export function mergeMeanMoments(left: MeanMoments, right: MeanMoments): MeanMoments {
  if (right.count === 0) return left;
  if (left.count === 0) return right;

  const count = left.count + right.count;
  const leftMean = left.meanUs as number;
  const rightMean = right.meanUs as number;
  return {
    count,
    meanUs: leftMean + ((rightMean - leftMean) * right.count) / count,
  };
}

/**
 * Combines two independently calculated variance states with Chan's formula.
 *
 *        left values                    right values
 *   count, mean, M2      +         count, mean, M2
 *                 \                 /
 *                  merged count, mean, M2
 *
 * The delta term accounts for the distance between the two means. This avoids
 * the unstable alternative of subtracting two enormous raw squared sums.
 */
export function mergeVarianceMoments(left: VarianceMoments, right: VarianceMoments): VarianceMoments {
  if (right.count === 0) return left;
  if (left.count === 0) return right;

  const count = left.count + right.count;
  const leftMean = left.meanUs as number;
  const rightMean = right.meanUs as number;
  const delta = rightMean - leftMean;
  return {
    count,
    meanUs: leftMean + (delta * right.count) / count,
    m2UsSquared: left.m2UsSquared + right.m2UsSquared + (delta * delta * left.count * right.count) / count,
  };
}
