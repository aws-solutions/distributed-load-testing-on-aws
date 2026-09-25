// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  getTestAssetCandidates,
  type LoadTestFramework,
  type TestAssetExtension,
  type TestAssetFileType,
  type TestAssetObject,
} from "@amzn/dlt-common";
import type { S3Client } from "@aws-sdk/client-s3";
import { NoSuchKey } from "@aws-sdk/client-s3";
import { join } from "node:path";
import type { Logger } from "../logger.js";
import { downloadToFile } from "./download-to-file.js";

export type DownloadableFileType = TestAssetFileType;

export interface DownloadScriptInput {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly testId: string;
  readonly framework: LoadTestFramework;
  readonly fileType: DownloadableFileType;
  readonly destDir: string;
  readonly logger: Logger;
}

export interface DownloadScriptResult {
  readonly localPath: string;
  readonly extension: TestAssetExtension;
}

export async function downloadScript(input: DownloadScriptInput): Promise<DownloadScriptResult> {
  const candidates = getTestAssetCandidates(input.framework, input.fileType, input.testId);

  // Try each candidate in order; only a missing object falls through to the next.
  for (const [index, candidate] of candidates.entries()) {
    try {
      return await downloadOne(input, candidate);
    } catch (err) {
      const hasFallback = index < candidates.length - 1;
      if (!(err instanceof NoSuchKey) || !hasFallback) throw err;
      input.logger.info({ testId: input.testId }, `no .${candidate.extension} script found; trying fallback`);
    }
  }

  throw new Error(`No test asset candidates configured for ${input.framework} ${input.fileType}`);
}

async function downloadOne(input: DownloadScriptInput, candidate: TestAssetObject): Promise<DownloadScriptResult> {
  const localPath = join(input.destDir, `${input.testId}.${candidate.extension}`);
  await downloadToFile({ s3: input.s3, bucket: input.bucket, key: candidate.key, destPath: localPath });
  input.logger.info({ key: candidate.key, localPath }, "downloaded test script");
  return { localPath, extension: candidate.extension };
}
