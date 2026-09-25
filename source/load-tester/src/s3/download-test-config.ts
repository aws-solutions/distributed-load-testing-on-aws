// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { S3Client } from "@aws-sdk/client-s3";
import { testConfigKey } from "@amzn/dlt-common";
import { downloadToFile } from "./download-to-file.js";
import type { Logger } from "../logger.js";

export interface DownloadTestConfigInput {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly testId: string;
  readonly testRegion: string;
  readonly destPath: string;
  readonly logger: Logger;
}

export async function downloadTestConfig(input: DownloadTestConfigInput): Promise<void> {
  const key = testConfigKey(input.testId, input.testRegion);
  await downloadToFile({ s3: input.s3, bucket: input.bucket, key, destPath: input.destPath });
  input.logger.info({ key, destPath: input.destPath }, "downloaded test config");
}
