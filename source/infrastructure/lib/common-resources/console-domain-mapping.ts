// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * AWS Management Console domains by partition.
 *
 * Used with `CfnMapping` + `Fn.findInMap(Aws.PARTITION, "domain")` to build
 * partition-aware console URLs at synth time.
 *
 * See:
 *   - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html
 *   - https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/configure-account.html
 *   - https://docs.amazonaws.cn/en_us/aws/latest/userguide/console.html
 */
export const CONSOLE_DOMAIN_MAPPING: Record<string, { domain: string }> = {
  aws: { domain: "console.aws.amazon.com" },
  "aws-us-gov": { domain: "console.amazonaws-us-gov.com" },
  "aws-cn": { domain: "console.amazonaws.cn" },
};
