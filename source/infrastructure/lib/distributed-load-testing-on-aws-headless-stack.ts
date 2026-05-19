// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnMapping, CfnOutput } from "aws-cdk-lib";
import { DLTBaseStack, IDLTConsole } from "./distributed-load-testing-on-aws-base-stack";
import { DLTConsoleHeadlessConstruct } from "./front-end/console-headless";
import { CONSOLE_DOMAIN_MAPPING } from "./common-resources/console-domain-mapping";

/**
 * Distributed Load Testing on AWS - Headless Stack
 *
 * Provides the DLT backend services without hosting the web console.
 * The web console assets are stored in S3 for customers to download and host
 * on their own infrastructure.
 *
 * Use cases:
 * - On-premises hosting requirements
 * - Integration with existing web infrastructure
 * - Custom hosting solutions
 */
export class DLTHeadlessStack extends DLTBaseStack {
  protected createConsoleConstruct(): IDLTConsole {
    return new DLTConsoleHeadlessConstruct(this, "DLTConsoleResources", {
      s3LogsBucket: this.commonResources.s3LogsBucket,
      solutionId: this.solutionId,
    });
  }

  protected addAdditionalOutputs(console: IDLTConsole): void {
    const consoleDomainMap = new CfnMapping(this, "ConsoleDomainMap", {
      mapping: CONSOLE_DOMAIN_MAPPING,
    });

    const consoleDomain = consoleDomainMap.findInMap(Aws.PARTITION, "domain");

    new CfnOutput(this, "ConsoleAssetsBucket", {
      description: "S3 bucket containing web console ZIP package",
      value: `https://${Aws.REGION}.${consoleDomain}/s3/buckets/${console.consoleBucket.bucketName}?region=${Aws.REGION}`,
    });
  }
}
