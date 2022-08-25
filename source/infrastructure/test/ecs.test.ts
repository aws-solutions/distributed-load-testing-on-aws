// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from 'aws-cdk-lib';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ECSResourcesConstruct } from '../lib/testing-resources/ecs';

test('DLT ECS Test', () => {
  const stack = new Stack();
  const testPolicy = new Policy(stack, 'TestPolicy', {
    statements: [
      new PolicyStatement({
        resources: ['*'],
        actions: ['cloudwatch:Get*']
      })
    ]
  });
  const ecs = new ECSResourcesConstruct(stack, 'TestECS', {
    cloudWatchLogsPolicy: testPolicy,
    containerImage: 'testRepository/testImage:testTag',
    fargateVpcId: 'vpc-1a2b3c4d5e',
    scenariosS3Bucket: 'testscenariobucket',
    securityGroupEgress: '0.0.0.0/0',
    solutionId: 'SO0062'
  });
  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
  expect(stack).toHaveResource('AWS::ECS::Cluster', {
    ClusterSettings: [
      {
        'Name': 'containerInsights',
        'Value': 'enabled'
      }
    ]
  });
  expect(stack).toHaveResource('AWS::IAM::Role', {
    "AssumeRolePolicyDocument": {
      "Statement": [
        {
          "Action": "sts:AssumeRole",
          "Effect": "Allow",
          "Principal": {
            "Service": "ecs-tasks.amazonaws.com"
          }
        }
      ],
      "Version": "2012-10-17"
    }
  });
  expect(stack).toHaveResource('AWS::Logs::LogGroup', {
    "RetentionInDays": 365
  });
  expect(stack).toHaveResource('AWS::ECS::TaskDefinition');
  expect(stack).toHaveResource('AWS::EC2::SecurityGroup');
  expect(stack).toHaveResource('AWS::EC2::SecurityGroupIngress', {
    GroupId: {
      Ref: "TestECSDLTEcsSecurityGroupFE5016DC",
    },
    SourceSecurityGroupId: {
      Ref: "TestECSDLTEcsSecurityGroupFE5016DC",
    }
  });
  expect(stack).toHaveResource('AWS::EC2::SecurityGroupEgress', {
    Description: 'Allow tasks to call out to external resources'
  });
  expect(ecs.taskClusterName).toBeDefined();
  expect(ecs.ecsCloudWatchLogGroup).toBeDefined();
  expect(ecs.taskDefinitionArn).toBeDefined();
  expect(ecs.taskExecutionRoleArn).toBeDefined();
  expect(ecs.ecsSecurityGroupId).toBeDefined();
});