// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CloudFrontToS3 } from "@aws-solutions-constructs/aws-cloudfront-s3";
import { Aspects, Aws, CfnResource, Duration, Fn, IAspect, Stack } from "aws-cdk-lib";
import { ResponseHeadersPolicyProps, HeadersFrameOption, HeadersReferrerPolicy } from "aws-cdk-lib/aws-cloudfront";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source as S3Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct, IConstruct } from "constructs";
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

    // ResponseHeadersPolicy names must be unique per account and limited to 128 characters
    // Region is included in the name for multi-region deployments
    const responseHeadersPolicyProps: ResponseHeadersPolicyProps = {
      responseHeadersPolicyName: Fn.join("-", [
        Stack.of(this).stackName,
        Aws.REGION,
        "rhp", // Short for "response headers policy" to minimize length
      ]),
      comment: "Security headers policy for DLT console",
      securityHeadersBehavior: {
        contentTypeOptions: {
          override: true,
        },

        strictTransportSecurity: {
          accessControlMaxAge: Duration.seconds(47304000),
          includeSubdomains: true,
          override: true,
        },

        // Referrer policy - safe with Cognito
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },

        frameOptions: {
          frameOption: HeadersFrameOption.DENY,
          override: true,
        },

        // Content Security Policy configured for AWS services and Cognito
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self' https://*.amazonaws.com https://*.amazoncognito.com; upgrade-insecure-requests;",
            "script-src 'self' https://*.amazonaws.com https://*.amazoncognito.com;",
            "style-src 'self' 'unsafe-inline' https://*.amazonaws.com;",
            "img-src 'self' data: https://*.amazonaws.com;",
            "font-src 'self' data:;",
            "connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com wss://*.amazonaws.com;",
            "frame-src 'self' https://*.amazonaws.com;",
            "frame-ancestors 'self' https://*.amazonaws.com;",
            "object-src 'none';",
            "base-uri 'self';",
            "form-action 'self' https://*.amazonaws.com;",
          ].join(" "),
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: "Permissions-Policy",
            value:
              "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
            override: true,
          },
          {
            header: "Cross-Origin-Resource-Policy",
            value: "same-origin",
            override: true,
          },
        ],
      },
    };

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
      insertHttpSecurityHeaders: false, // Keep this false since we're using custom headers
      responseHeadersPolicyProps, // Apply custom response headers policy props at the construct level
    });

    this.consoleBucket = dltS3CloudFrontDist.s3BucketInterface;
    this.webAppURL = `https://${dltS3CloudFrontDist.cloudFrontWebDistribution.domainName}`;
    this.consoleBucketArn = dltS3CloudFrontDist.s3BucketInterface.bucketArn;

    new BucketDeployment(this, "DeployWebsite", {
      sources: [S3Source.asset(path.join(__dirname, "../../../webui/dist"))],
      destinationBucket: this.consoleBucket,
      exclude: ["aws-exports.json"],
      distribution: dltS3CloudFrontDist.cloudFrontWebDistribution,
      distributionPaths: ["/*"],
    });

    // Add cfn_nag exception for the Lambda function created by BucketDeployment
    // Create an aspect that will add metadata to all Lambda functions created by BucketDeployment
    class BucketDeploymentLambdaAspect implements IAspect {
      visit(node: IConstruct): void {
        // Check if this is a Lambda function
        if (node instanceof CfnResource && node.cfnResourceType === "AWS::Lambda::Function") {
          // Check if this Lambda function is part of a BucketDeployment
          // BucketDeployment Lambda functions typically have IDs that start with "CustomCDKBucketDeployment"
          const logicalId = Stack.of(node).getLogicalId(node);
          if (logicalId.startsWith("CustomCDKBucketDeployment")) {
            // Add cfn_nag suppressions
            node.addMetadata("cfn_nag", {
              rules_to_suppress: [
                {
                  id: "W58",
                  reason: "Lambda function created by BucketDeployment has appropriate IAM permissions managed by CDK",
                },
                {
                  id: "W89",
                  reason:
                    "Lambda function created by BucketDeployment does not need to be in a VPC as it only copies files to S3",
                },
                {
                  id: "W92",
                  reason:
                    "Lambda function created by BucketDeployment is temporary and does not need reserved concurrency",
                },
              ],
            });
          }
        }
      }
    }
    // Apply the aspect to the entire stack
    Aspects.of(Stack.of(this)).add(new BucketDeploymentLambdaAspect());
  }
}
