// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';

import { CognitoAuthConstruct } from '../lib/auth';


test('DLT API Test', () => {
  const stack = new Stack();

  const auth = new CognitoAuthConstruct(stack, 'TestAuth', {
    adminEmail: 'test@test.com',
    adminName: 'testname',
    apiId: 'apiId12345',
    cloudFrontDomainName: 'test.com',
    scenariosBucketArn: 'arn:aws:s3:::DOC-EXAMPLE-BUCKET'
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
