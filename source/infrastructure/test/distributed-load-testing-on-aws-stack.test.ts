// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { App } from 'aws-cdk-lib';
import { DLTStack } from '../lib/distributed-load-testing-on-aws-stack';

const props = {
  codeBucket: 'testbucket',
  codeVersion: 'testversion',
  description: 'Distributed Load Testing on AWS is a reference architecture to perform application load testing at scale.',
  publicECRRegistry: 'testRegistry',
  publicECRTag: 'testTag',
  solutionId: 'testId',
  solutionName: 'distributed-load-testing-on-aws',
  stackType: 'main',
  url: 'http://testurl.com'
};

test('Distributed Load Testing stack test', () => {
  const app = new App();
  const stack = new DLTStack(app, 'TestDLTStack', props);

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
