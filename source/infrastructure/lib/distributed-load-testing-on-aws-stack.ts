// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DLTBaseStack, DLTBaseStackProps, IDLTConsole } from "./distributed-load-testing-on-aws-base-stack";
import { DLTConsoleCloudFrontConstruct } from "./front-end/console-cloudfront";

export { DLTBaseStackProps as DLTStackProps };

/**
 * Distributed Load Testing on AWS - CloudFront Console Stack (Default)
 *
 * Uses CloudFront + S3 to host the web console.
 */
export class DLTStack extends DLTBaseStack {
  protected createConsoleConstruct(): IDLTConsole {
    return new DLTConsoleCloudFrontConstruct(this, "DLTConsoleResources", {
      s3LogsBucket: this.commonResources.s3LogsBucket,
      solutionId: this.solutionId,
    });
  }
}
