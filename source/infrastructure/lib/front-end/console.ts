// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CloudFrontToS3 } from "@aws-solutions-constructs/aws-cloudfront-s3";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { BucketDeployment, Source as S3Source } from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";

export interface DLTConsoleConstructProps {
  readonly s3LogsBucket: Bucket;
  readonly solutionId: string;
}

export class DLTConsoleConstruct extends Construct {
  public webAppURL: string;
  public consoleBucketArn: string;
  public consoleBucket: IBucket;

  constructor(scope: Construct, id: string, props: DLTConsoleConstructProps) {
    super(scope, id);

    // Create the standard region CloudFront distribution
    const dltS3CloudFrontDist = new CloudFrontToS3(this, "DLTDashboardS3", {
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

    this.consoleBucket = dltS3CloudFrontDist.s3BucketInterface;
    this.webAppURL = `https://${dltS3CloudFrontDist.cloudFrontWebDistribution.domainName}`;
    this.consoleBucketArn = dltS3CloudFrontDist.s3BucketInterface.bucketArn;

    new BucketDeployment(this, "DeployWebsite", {
      sources: [S3Source.asset(path.join(__dirname, "../../../console/build"))], // build react app before cdk deploy
      destinationBucket: this.consoleBucket,
      exclude: ["assets/aws_config.js"],
    });
  }
}
