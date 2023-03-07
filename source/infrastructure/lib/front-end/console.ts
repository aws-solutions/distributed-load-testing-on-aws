// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CloudFrontToS3 } from "@aws-solutions-constructs/aws-cloudfront-s3";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/**
 * @interface DLTConsoleConstructProps
 * DLTConsoleConstruct props
 */
export interface DLTConsoleConstructProps {
  // S3 Logs Bucket
  readonly s3LogsBucket: Bucket;
  // Solution ID
  readonly solutionId: string;
}

/**
 * Distributed Load Testing on AWS console construct
 * This creates the S3 bucket and CloudFront distribution
 * and Cognito resources for the web front end.
 */
export class DLTConsoleConstruct extends Construct {
  public cloudFrontDomainName: string;
  public consoleBucketArn: string;
  public consoleBucket: IBucket;

  constructor(scope: Construct, id: string, props: DLTConsoleConstructProps) {
    super(scope, id);

    const dltS3CloudFrontDist = new CloudFrontToS3(this, "DLTCloudFrontToS3", {
      bucketProps: {
        serverAccessLogsBucket: props.s3LogsBucket,
        serverAccessLogsPrefix: "console-bucket-access/",
      },
      cloudFrontDistributionProps: {
        comment: "Website distribution for the Distributed Load Testing solution",
        enableLogging: true,
        errorResponses: [
          { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
          { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
        ],
        httpVersion: "http2",
        logBucket: props.s3LogsBucket,
        logFilePrefix: "cloudfront-logs/",
      },
      insertHttpSecurityHeaders: false,
    });

    this.cloudFrontDomainName = dltS3CloudFrontDist.cloudFrontWebDistribution.domainName;
    this.consoleBucket = dltS3CloudFrontDist.s3BucketInterface;

    this.consoleBucketArn = dltS3CloudFrontDist.s3BucketInterface.bucketArn;
  }
}
