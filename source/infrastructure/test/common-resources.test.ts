// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from 'aws-cdk-lib';
import { CommonResourcesConstruct } from '../lib/common-resources/common-resources';

test('DLT API Test', () => {
  const stack = new Stack();

  const common = new CommonResourcesConstruct(stack, 'TestCommonResources', {
    sourceCodeBucket: 'testbucketname'
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
  expect(common.s3LogsBucket).toBeDefined();
  expect(common.sourceBucket).toBeDefined();
});
