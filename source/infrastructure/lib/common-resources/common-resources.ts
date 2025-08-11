// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ArnFormat, CfnResource, RemovalPolicy, Stack } from "aws-cdk-lib";
import { BlockPublicAccess, Bucket, BucketAccessControl, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { AnyPrincipal, Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { Solution } from "../../bin/solution";
import { CustomResourceLambda } from "./custom-resource-lambda";

interface ICommonResources {
  cloudWatchLogsPolicy: Policy;
  s3LogsBucket: Bucket;
  customResourceLambda: CustomResourceLambda;
}

/**
 * Distributed Load Testing on AWS common resources construct.
 * Creates a CloudWatch logs policy and an S3 bucket to store logs.
 */
export class CommonResources extends Construct implements ICommonResources {
  public readonly cloudWatchLogsPolicy: Policy;
  public readonly s3LogsBucket: Bucket;
  public readonly customResourceLambda: CustomResourceLambda;

  constructor(scope: Construct, id: string, solution: Solution, stackType: string) {
    super(scope, id);

    const logGroupResourceArn = Stack.of(this).formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: "/aws/lambda/*",
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    this.cloudWatchLogsPolicy = new Policy(this, "CloudWatchLogsPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [logGroupResourceArn],
        }),
      ],
    });

    this.s3LogsBucket = this.createLogsBucket();

    const customResourceLambda = new CustomResourceLambda(this, "CustomResource", solution, stackType);
    customResourceLambda.addPolicy([this.cloudWatchLogsPolicy]);
    this.customResourceLambda = customResourceLambda;
  }

  private createLogsBucket(): Bucket {
    const logsBucket = new Bucket(this, "LogsBucket", {
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      enforceSSL: true,
      versioned: true,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
    });

    logsBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:*"],
        conditions: {
          Bool: { "aws:SecureTransport": "false" },
        },
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        resources: [logsBucket.bucketArn, logsBucket.arnForObjects("*")],
      })
    );

    const s3LogsBucketResource = logsBucket.node.defaultChild as CfnResource;
    s3LogsBucketResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W35",
          reason: "This is the logging bucket, it does not require logging.",
        },
        {
          id: "W51",
          reason: "Since the bucket does not allow the public access, it does not require to have bucket policy.",
        },
      ],
    });
    return logsBucket;
  }
}
