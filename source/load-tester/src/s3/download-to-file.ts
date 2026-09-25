// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export interface DownloadToFileInput {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly key: string;
  readonly destPath: string;
}

// Streams the S3 object to disk without buffering — user-uploaded zips
// can be arbitrarily large. The Body is always a Node.js Readable on
// Fargate; the instanceof check guards against SDK type changes.
export async function downloadToFile(input: DownloadToFileInput): Promise<void> {
  const response = await input.s3.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
  if (!(response.Body instanceof Readable)) {
    throw new Error(`S3 GetObject returned unexpected body type for s3://${input.bucket}/${input.key}`);
  }
  await pipeline(response.Body, createWriteStream(input.destPath));
}
