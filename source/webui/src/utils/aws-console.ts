// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Returns the AWS Management Console domain for a given region.
 *
 * AWS has three partitions, each with its own console domain:
 *   - aws (commercial):    console.aws.amazon.com
 *   - aws-us-gov:          console.amazonaws-us-gov.com
 *   - aws-cn:              console.amazonaws.cn
 *
 * Partition is derived from the region prefix:
 *   - us-gov-*  -> aws-us-gov
 *   - cn-*      -> aws-cn
 *   - anything else (or unknown) -> aws (commercial fallback)
 *
 * See:
 *   - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html
 *   - https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/configure-account.html
 *   - https://docs.amazonaws.cn/en_us/aws/latest/userguide/console.html
 */
export function getConsoleDomain(region: string | undefined | null): string {
  if (typeof region === "string") {
    if (region.startsWith("us-gov-")) {
      return "console.amazonaws-us-gov.com";
    }
    if (region.startsWith("cn-")) {
      return "console.amazonaws.cn";
    }
  }
  return "console.aws.amazon.com";
}
