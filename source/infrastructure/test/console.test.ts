// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from 'aws-cdk-lib';
import { DLTConsoleConstruct } from '../lib/front-end/console';
import { Bucket } from 'aws-cdk-lib/aws-s3';


test('DLT API Test', () => {
  const stack = new Stack();
  const testSourceBucket = new Bucket(stack, 'testSourceCodeBucket');

  const console = new DLTConsoleConstruct(stack, 'TestConsoleResources', {
    s3LogsBucket: testSourceBucket,
    solutionId: 'testId',
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
  expect(console.cloudFrontDomainName).toBeDefined();
  expect(console.consoleBucket).toBeDefined();
  expect(console.consoleBucketArn).toBeDefined();
});
