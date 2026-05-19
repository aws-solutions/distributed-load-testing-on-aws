// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Headless Console Construct
 *
 * Provides S3 bucket with web console assets for customers to download
 * and host on their own infrastructure.
 */

import { RemovalPolicy } from "aws-cdk-lib";
import { Bucket, IBucket, BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface DLTConsoleHeadlessConstructProps {
  readonly s3LogsBucket: Bucket;
  readonly solutionId: string;
}

export class DLTConsoleHeadlessConstruct extends Construct {
  public webAppURL: string;
  public consoleBucketArn: string;
  public consoleBucket: IBucket;
  // Flag to indicate this stack needs web console ZIP generation
  public readonly needsWebConsoleZip = true;

  // Flag indicating web console is customer self-hosted (Cognito callback URLs exclude webAppURL)
  public readonly isConsoleHostedExternally = true;
  constructor(scope: Construct, id: string, props: DLTConsoleHeadlessConstructProps) {
    super(scope, id);

    // Allow any origins for CORS - actual hosting URL unknown at deploy time
    this.webAppURL = "*";

    // S3 bucket for web console assets
    const consoleBucket = new Bucket(this, "ConsoleBucket", {
      removalPolicy: RemovalPolicy.RETAIN,
      serverAccessLogsBucket: props.s3LogsBucket,
      serverAccessLogsPrefix: "console-bucket-access/",
      encryption: BucketEncryption.KMS_MANAGED,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
    this.consoleBucket = consoleBucket;
    this.consoleBucketArn = consoleBucket.bucketArn;
  }
}
