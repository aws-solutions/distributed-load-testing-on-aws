// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/**
 * S3 key prefix for start signal markers.
 *
 * Each region's tasks poll their own prefix to avoid the 5,500 GET/HEAD
 * per-prefix S3 baseline limit. Full key format:
 *   `start-signal/{testId}/{prefix}/{region}/start`
 */
export const START_SIGNAL_PREFIX = "start-signal";

export interface WriteStartMarkerParams {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly testId: string;
  readonly prefix: string;
  readonly region: string;
  readonly logger: Logger;
}

export interface StartCommandResult {
  readonly s3Key: string;
}

/**
 * Writes an S3 start marker for a specific region.
 *
 * Each container in the region polls for this marker using S3 HEAD.
 * When the marker exists, the container proceeds with test execution.
 *
 * The marker is an empty object — its existence is the signal, not its
 * content. Per-region prefixes ensure each region's polling traffic stays
 * within S3's 5,500 requests/second per-prefix baseline.
 */
export async function writeStartMarker(params: WriteStartMarkerParams): Promise<StartCommandResult> {
  const { s3, bucket, testId, prefix, region, logger } = params;

  const s3Key = `${START_SIGNAL_PREFIX}/${testId}/${prefix}/${region}/start`;

  logger.info("Writing S3 start marker", { bucket, s3Key, region });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: "",
    })
  );

  logger.info("S3 start marker written", { s3Key });

  return { s3Key };
}
