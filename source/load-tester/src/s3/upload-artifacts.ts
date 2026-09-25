// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Logger } from "../logger.js";

// S3 requires every multipart part except the last to be at least 5 MiB.
// https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
const MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

export interface UploadArtifactsInput {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly keyPrefix: string;
  readonly artifactsDir: string;
  /** Files that must reach S3 for downstream processing (e.g. result.json).
   *  A required file that is absent from the artifacts dir logs at error level.
   *  Upload failures are reported separately per file regardless of whether
   *  the file is required. Neither case crashes the container. */
  readonly requiredFiles?: readonly string[];
  readonly logger: Logger;
}

export async function uploadArtifacts(input: UploadArtifactsInput): Promise<void> {
  const entries = await readdir(input.artifactsDir, { withFileTypes: true });
  const requiredFiles = new Set(input.requiredFiles ?? []);
  const allFiles = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const files = [
    ...allFiles.filter((name) => requiredFiles.has(name)),
    ...allFiles.filter((name) => !requiredFiles.has(name)),
  ];

  // Required results go first so they are not stranded behind large raw data
  // files during shutdown. Upload sequentially to bound memory and avoid
  // thundering-herd S3 rate limiting when many Fargate tasks finish together.
  for (const name of files) {
    await uploadOne(input, name);
  }

  // Required files that never made it into the artifacts dir had no upload
  // attempted, so they are not covered by the per-file upload-failure logging.
  const present = new Set(files);
  for (const required of input.requiredFiles ?? []) {
    if (!present.has(required)) {
      input.logger.error(
        { requiredFile: required, artifactsDir: input.artifactsDir },
        "required artifact missing from artifacts dir"
      );
    }
  }
}

async function uploadOne(input: UploadArtifactsInput, name: string): Promise<void> {
  const localPath = join(input.artifactsDir, name);
  const key = `${input.keyPrefix}/${name}`;
  try {
    const info = await stat(localPath);
    const stream = createReadStream(localPath);
    try {
      await new Upload({
        client: input.s3,
        params: {
          Bucket: input.bucket,
          Key: key,
          Body: stream,
          ContentLength: info.size,
        },
        // One buffered part preserves bounded memory when thousands of tasks finish together.
        queueSize: 1,
        partSize: MULTIPART_PART_SIZE_BYTES,
        // Failed multipart uploads must be aborted instead of retaining billable parts.
        // https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html
        leavePartsOnError: false,
      }).done();
    } finally {
      stream.destroy();
    }
    input.logger.info({ name, key, bytes: info.size }, "uploaded artifact");
  } catch (err) {
    input.logger.error({ err, name, key }, "artifact upload failed; continuing");
  }
}
