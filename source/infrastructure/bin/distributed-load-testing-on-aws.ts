#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DLTStack } from '../lib/distributed-load-testing-on-aws-stack';

const app = new cdk.App();
new DLTStack(app, 'DLTStack', {
    description: 'Distributed Load Testing for Pulse-ALP. Version CODE_VERSION'
});
