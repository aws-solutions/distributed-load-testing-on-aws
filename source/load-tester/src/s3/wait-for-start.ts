// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { setTimeout as sleep } from "node:timers/promises";
import type { S3Client } from "@aws-sdk/client-s3";
import { HeadObjectCommand, NotFound } from "@aws-sdk/client-s3";
import { startSignalKey } from "@amzn/dlt-common";
import type { Logger } from "../logger.js";

export interface WaitForStartSignalInput {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly testId: string;
  readonly prefix: string;
  readonly awsRegion: string;
  readonly signal: AbortSignal;
  readonly logger: Logger;
}

const POLL_INTERVAL_MS = 2000;

export async function waitForStartSignal(input: WaitForStartSignalInput): Promise<void> {
  const key = startSignalKey(input.testId, input.prefix, input.awsRegion);
  const pollMs = POLL_INTERVAL_MS;
  for (;;) {
    input.signal.throwIfAborted();
    try {
      await input.s3.send(new HeadObjectCommand({ Bucket: input.bucket, Key: key }), {
        abortSignal: input.signal,
      });
      input.logger.info({ key }, "start signal received");
      return;
    } catch (err) {
      if (err instanceof NotFound) {
        // Expected — start signal not yet written. Keep polling.
      } else {
        // Transient S3 errors (503, throttle, network) — log and retry
        // on next poll iteration rather than crashing the container.
        input.logger.warn({ err, key }, "S3 poll error; will retry");
      }
    }
    await sleep(pollMs, undefined, { signal: input.signal });
  }
}
