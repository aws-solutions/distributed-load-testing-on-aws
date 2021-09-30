// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import { CustomResourcesConstruct } from '../lib/custom-resources';

test('DLT API Test', () => {
  const stack = new Stack();

  const custResources = new CustomResourcesConstruct(stack, 'TestCustomResources', {
    apiEndpoint: 'http://testEndpointUrl.com',
    customResourceLambda: 'testcustomlambda',
    cognitoIdentityPool: 'testIdentityPool',
    cognitoUserPool: 'testUserPool',
    cognitoUserPoolClient: 'testUserPoolClient',
    consoleBucketName: 'testConsoleBucket',
    scenariosBucket: 'testScenariosBucket',
    sourceCodeBucketName: 'testCodeBucket',
    sourceCodePrefix: 'testCodePrefix/',
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
  expect(stack).toHaveResource('Custom::CopyConsoleFiles');
  expect(stack).toHaveResource('Custom::CopyConfigFiles');
});
