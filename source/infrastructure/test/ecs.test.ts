// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import { FargateECSTestRunnerContruct } from '../lib/ecs';

test('DLT ECS Test', () => {
    const stack = new Stack();
    const ecs = new FargateECSTestRunnerContruct(stack, 'TestECS', {
        DLTfargateVpcId: 'vpc-1a2b3c4d5e',
        securityGroupEgress: '0.0.0.0/0',
        solutionId: 'SO0062'
    });
    expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
    expect(stack).toHaveResource('AWS::ECR::Repository', {
        ImageScanningConfiguration: {
            ScanOnPush: true
        }
    });
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
    })
});