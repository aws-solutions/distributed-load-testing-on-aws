// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import type { S3Client } from "@aws-sdk/client-s3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

/**
 * Input for the S3 completion marker monitoring function.
 *
 * Each Fargate task writes a zero-byte completion marker to:
 *   `s3://{bucket}/results/{testId}/{prefix}/completion/{region}/{taskId}`
 *
 * This function counts those markers to determine how many tasks have
 * finished. The step function drives the polling loop (Wait → Lambda →
 * Choice); this function is called once per iteration.
 */
export interface CompletionMonitorInput {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly testId: string;
  readonly prefix: string;
  readonly region: string;
  readonly desiredCount: number;
  readonly logger: Logger;
}

export interface CompletionMonitorResult {
  /** Number of S3 completion markers found */
  readonly completedTaskCount: number;
  /** True when completedTaskCount >= desiredCount */
  readonly isComplete: boolean;
}

/**
 * Counts S3 completion markers for a single region and returns whether
 * all tasks have finished.
 *
 * Uses paginated `ListObjectsV2` to handle tests with >1000 tasks.
 * Only counts the number of objects under the completion prefix — does
 * not inspect object contents (markers are zero-byte files).
 */
export async function monitorCompletion(input: CompletionMonitorInput): Promise<CompletionMonitorResult> {
  const { s3, bucket, testId, prefix, region, desiredCount, logger } = input;

  const completionPrefix = `results/${testId}/${prefix}/completion/${region}/`;

  logger.info("Listing completion markers", { bucket, completionPrefix, desiredCount });

  let completedTaskCount = 0;
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: completionPrefix,
        ContinuationToken: continuationToken,
      })
    );

    completedTaskCount += response.KeyCount ?? 0;
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  const isComplete = completedTaskCount >= desiredCount;

  logger.info("Completion monitor result", { completedTaskCount, desiredCount, isComplete });

  return { completedTaskCount, isComplete };
}
