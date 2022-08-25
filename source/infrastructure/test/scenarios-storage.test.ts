// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from 'aws-cdk-lib';
import { ScenarioTestRunnerStorageConstruct } from '../lib/back-end/scenarios-storage';
import { Bucket } from 'aws-cdk-lib/aws-s3';


test('DLT API Test', () => {
  const stack = new Stack();
  const testLogsBucket = new Bucket(stack, 'testLogsBucket');

  const storage = new ScenarioTestRunnerStorageConstruct(stack, 'TestScenarioStorage', {
    s3LogsBucket: testLogsBucket,
    cloudFrontDomainName: 'test.exampledomain.com',
    solutionId: 'testId'
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
  expect(storage.scenariosBucket).toBeDefined();
  expect(storage.scenariosS3Policy).toBeDefined();
  expect(storage.scenariosTable).toBeDefined();
  expect(storage.historyTable).toBeDefined();
  expect(storage.scenarioDynamoDbPolicy).toBeDefined();
  expect(storage.historyDynamoDbPolicy).toBeDefined();
});
