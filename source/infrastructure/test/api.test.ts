// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import { LogGroup } from '@aws-cdk/aws-logs';
import { DLTAPI } from '../lib/api';
import { Bucket } from '@aws-cdk/aws-s3';
import { Policy, PolicyStatement } from '@aws-cdk/aws-iam';

test('DLT API Test', () => {
  const stack = new Stack();
  const testLog = new LogGroup(stack, 'TestLogGroup');
  const testPolicy = new Policy(stack, 'TestPolicy', {
    statements: [
      new PolicyStatement({
        resources: ['*'],
        actions: ['cloudwatch:Get*']
      })
    ]
  });
  const testSourceBucket = Bucket.fromBucketName(stack, 'SourceCodeBucket', 'test-bucket-region');
  const api = new DLTAPI(stack, 'TestAPI', {
    ecsCloudWatchLogGroup: testLog,
    cloudWatchLogsPolicy: testPolicy,
    dynamoDbPolicy: testPolicy,
    taskCancelerInvokePolicy: testPolicy,
    scenariosS3Policy: testPolicy,
    scenariosBucketName: 'testScenarioBucketName',
    scenariosTableName: 'testDDBTable',
    ecsCuster: 'testECSCluster',
    ecsTaskExecutionRoleArn: 'arn:aws:iam::1234567890:role/MyRole-AJJHDSKSDF',
    taskRunnerStepFunctionsArn: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
    tastCancelerArn: 'arn:aws:lambda:us-east-1:111122223333:function:HelloFunction',
    metricsUrl: 'http://testurl.com',
    sendAnonymousUsage: 'Yes',
    solutionId: 'testId',
    solutionVersion: 'testVersion',
    sourceCodeBucket: testSourceBucket,
    sourceCodePrefix: 'testPrefix/',
    uuid: 'abc123'
  });

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
