// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { CfnCondition, Fn, Stack } from '@aws-cdk/core';
import { Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { CommonResourcesContruct } from '../lib/common-resources';

test('DLT API Test', () => {
  const stack = new Stack();
  const testRole = new Role(stack, 'TestRole', {
    assumedBy: new ServicePrincipal('apigateway.amazonaws.com')
  });
  const sendAnonymousUsageCondition = new CfnCondition(stack, 'condition', {
    expression: Fn.conditionIf('testCondition', true, false)
  })
  const boolExistingVpc = 'false';

  const common = new CommonResourcesContruct(stack, 'TestCommonResources', {
    dltEcsTaskExecutionRole: testRole,
    solutionId: 'testId',
    solutionVersion: 'testVersion',
    sourceCodeBucket: 'testbucketname',
    sourceCodePrefix: '/testPrefix',
    sendAnonymousUsageCondition,
    existingVpc: boolExistingVpc,
    metricsUrl: 'http://testMetricsUrl.com'
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
