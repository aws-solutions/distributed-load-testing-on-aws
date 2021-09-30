// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { App } from '@aws-cdk/core';
import { DLTStack } from '../lib/distributed-load-testing-on-aws-stack';

test('Distributed Load Testing stack test', () => {
    const app = new App();
    const stack = new DLTStack(app, 'TestDLTStack');

    expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});