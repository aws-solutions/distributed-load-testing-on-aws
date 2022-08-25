// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CustomResourceInfraConstruct } from '../lib/custom-resources/custom-resources-infra';


test('DLT API Test', () => {

  const stack = new Stack();
  const testSourceBucket = new Bucket(stack, 'testSourceCodeBucket');
  const testPolicy = new Policy(stack, 'TestPolicy', {
    statements: [
      new PolicyStatement({
        resources: ['*'],
        actions: ['cloudwatch:Get*']
      })
    ]
  });

  new CustomResourceInfraConstruct(stack, 'TestCustomResourceInfra', {
    cloudWatchPolicy: testPolicy,
    consoleBucketArn: 'test:console:bucket:arn',
    mainStackRegion: 'test-region-1',
    metricsUrl: 'http://testurl.com',
    scenariosS3Bucket: 'scenariotestbucket',
    scenariosTable: 'scenarioTestTable',
    solutionId: 'S0XXX',
    solutionVersion: 'testVersion',
    sourceCodeBucket: testSourceBucket,
    sourceCodePrefix: 'test/source/prefix',
    stackType: 'main'
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
  expect(stack).toHaveResourceLike('AWS::Lambda::Function', {
    Code: {
      S3Bucket: {
        "Ref": "testSourceCodeBucketC577B176",
      },
      S3Key: "test/source/prefix/main-custom-resource.zip",
    },
    Description: "CFN Lambda backed custom resource to deploy assets to s3",
    Environment: {
      Variables: {
        DDB_TABLE: "scenarioTestTable",
        MAIN_REGION: "test-region-1",
        METRIC_URL: "http://testurl.com",
        S3_BUCKET: "scenariotestbucket",
        SOLUTION_ID: "S0XXX",
        VERSION: "testVersion",
      }
    },
    Handler: "index.handler",
    Role: {
      "Fn::GetAtt": [
        "TestCustomResourceInfraCustomResourceLambdaRole03671AE8",
        "Arn",
      ],
    },
    Runtime: "nodejs14.x",
    Timeout: 120
  });
});
