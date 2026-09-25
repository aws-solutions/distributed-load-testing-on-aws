// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { S3Client } from "@aws-sdk/client-s3";

export interface CreateS3ClientInput {
  readonly region: string;
}

// Adaptive retry with 10 attempts handles the concurrent load from
// 1000s of Fargate tasks all calling S3 during startup/poll phases.
//
// Increased latency to ensure successful S3 operations are acceptable
// given the long-running nature of load tests. The risk of losing artifacts
// for an expensive load test outweighs a slight increase in latency.
export function createS3Client(input: CreateS3ClientInput): S3Client {
  return new S3Client({
    region: input.region,
    retryMode: "adaptive",
    maxAttempts: 10,
  });
}
