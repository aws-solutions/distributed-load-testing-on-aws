// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import { DLTConsoleContruct } from '../lib/console';
import { Code, Function as LambdaFunction, Runtime } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';


test('DLT API Test', () => {
  const stack = new Stack();
  const testSourceBucket = new Bucket(stack, 'testSourceCodeBucket');

  const testRole = new Role(stack, 'TestCustomResourceRole', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    inlinePolicies: {
      'DenyPolicy': new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ['*'],
            resources: ['*']
          })
        ]
      })
    }
  });
  const testLambda = new LambdaFunction(stack, 'TestFunction', {
    code: Code.fromBucket(Bucket.fromBucketName(stack, 'SourceCodeBucket', 'TestBucket'), 'custom-resource.zip'),
    handler: 'index.handler',
    runtime: Runtime.NODEJS_14_X,
    role: testRole
  });


  const console = new DLTConsoleContruct(stack, 'TestConsoleResources', {
    customResource: testLambda,
    s3LogsBucket: testSourceBucket,
    solutionId: 'testId',
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
