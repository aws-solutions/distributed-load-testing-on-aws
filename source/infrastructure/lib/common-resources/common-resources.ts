// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CfnResource, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketAccessControl, BucketEncryption, IBucket } from 'aws-cdk-lib/aws-s3';
import { AnyPrincipal, Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CommonResourcesConstructProps {
  readonly sourceCodeBucket: string;
}

/**
 * Distributed Load Testing on AWS common resources construct.
 * Creates a CloudWatch logs policy and an S3 bucket to store logs.
 */
export class CommonResourcesConstruct extends Construct {
  // CloudWatch logs Policy
  public cloudWatchLogsPolicy: Policy;
  // Code S3 Bucket
  public sourceBucket: IBucket;


  constructor(scope: Construct, id: string, props: CommonResourcesConstructProps) {
    super(scope, id);

    const logGroupResourceArn = Stack.of(this).formatArn({ service: 'logs', resource: 'log-group:', resourceName: 'aws/lambda/*' });
    this.cloudWatchLogsPolicy = new Policy(this, 'CloudWatchLogsPolicy', {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [
            logGroupResourceArn
          ]
        })
      ]
    });

    this.sourceBucket = Bucket.fromBucketName(this, 'SourceCodeBucket', props.sourceCodeBucket);
  }

  public s3LogsBucket(): Bucket {
    const logsBucket = new Bucket(this, 'LogsBucket', {
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN
    });

    logsBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:*'],
        conditions: {
          Bool: { 'aws:SecureTransport': 'false' }
        },
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        resources: [logsBucket.bucketArn, logsBucket.arnForObjects('*')]
      }));

    const s3LogsBucketResource = logsBucket.node.defaultChild as CfnResource;
    s3LogsBucketResource.addMetadata('cfn_nag', {
      rules_to_suppress: [{
        id: 'W35',
        reason: 'This is the logging bucket, it does not require logging.'
      }]
    });
    return logsBucket;
  }
}