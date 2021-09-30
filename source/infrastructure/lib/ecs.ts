// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource, Construct, RemovalPolicy } from '@aws-cdk/core';
import { Repository } from '@aws-cdk/aws-ecr';
import { CfnCluster, CfnTaskDefinition } from '@aws-cdk/aws-ecs';
import { ManagedPolicy, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { LogGroup, RetentionDays } from '@aws-cdk/aws-logs';
import { CfnSecurityGroup, CfnSecurityGroupEgress, CfnSecurityGroupIngress } from '@aws-cdk/aws-ec2';

/**
 * FargateECSTestRunnerContruct props
 * @interface FargateECSTestRunnerContructProps
 */
export interface FargateECSTestRunnerContructProps {
    // Fargate VPC ID
    readonly DLTfargateVpcId: string;
    // IP CIDR for Fargate egress
    readonly securityGroupEgress: string;
    // Solution ID
    readonly solutionId: string;
}

/**
 * @class
 * Distributed Load Testing on AWS Fargate and ECS test runner construct.
 * This creates the ECS cluster, Fargate task definition, and Security Group
 */
export class FargateECSTestRunnerContruct extends Construct {
    public dltEcsClusterName: string;
    public dltCloudWatchLogGroup: LogGroup;
    public dltTaskDefinitionArn: string;
    public dltTaskExecutionRole: Role;
    public dltSecurityGroupId: string;

    constructor(scope: Construct, id: string, props: FargateECSTestRunnerContructProps) {
        super(scope, id);

        const dltEcr = new Repository(this, 'DLTECR', {
            imageScanOnPush: true
        });
        dltEcr.applyRemovalPolicy(RemovalPolicy.RETAIN);

        const dltEcsCluster = new CfnCluster(this, 'DLTEcsCluster', {
            clusterName: Aws.STACK_NAME,
            clusterSettings: [{ 'name': 'containerInsights', 'value': 'enabled' }],
            tags: [
                {
                    'key': 'SolutionId',
                    'value': props.solutionId
                },
                {
                    'key': 'CloudFormation Stack',
                    'value': Aws.STACK_NAME
                }
            ]

        });

        this.dltEcsClusterName = dltEcsCluster.ref;

        this.dltTaskExecutionRole = new Role(this, 'DLTTaskExecutionRole', {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')]
        });

        this.dltCloudWatchLogGroup = new LogGroup(this, 'DLTCloudWatchLogsGroup', {
            retention: RetentionDays.ONE_YEAR
        });
        const dltLogsGroupResource = this.dltCloudWatchLogGroup.node.defaultChild as CfnResource;
        dltLogsGroupResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W84',
                reason: 'KMS encryption unnecessary for log group'
            }]
        });

        const dltTaskDefinition = new CfnTaskDefinition(this, 'DLTTaskDefinition', {
            cpu: '2048',
            memory: '4096',
            networkMode: 'awsvpc',
            executionRoleArn: this.dltTaskExecutionRole.roleArn,
            requiresCompatibilities: ['FARGATE'],
            taskRoleArn: this.dltTaskExecutionRole.roleArn,
            containerDefinitions: [
                {
                    essential: true,
                    name: `${Aws.STACK_NAME}-load-tester`,
                    image: 'PUBLIC_ECR_REGISTRY/distributed-load-testing-on-aws-load-tester:PUBLIC_ECR_TAG',
                    memory: 4096,
                    logConfiguration: {
                        logDriver: 'awslogs',
                        options: {
                            'awslogs-group': this.dltCloudWatchLogGroup.logGroupName,
                            'awslogs-stream-prefix': 'load-testing',
                            'awslogs-region': `${Aws.REGION}`
                        }
                    }
                }
            ],
        });

        this.dltTaskDefinitionArn = dltTaskDefinition.ref;

        const dltEcsSecurityGroup = new CfnSecurityGroup(this, 'DLTEcsSecurityGroup', {
            vpcId: props.DLTfargateVpcId,
            groupDescription: 'DLTS Tasks Security Group'
        });
        dltEcsSecurityGroup.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W40',
                reason: 'IpProtocol set to -1 (any) as ports are not known prior to running tests'
            }]
        });

        this.dltSecurityGroupId = dltEcsSecurityGroup.ref;

        new CfnSecurityGroupEgress(this, 'DLTSecGroupEgress', {
            cidrIp: props.securityGroupEgress,
            description: 'Allow tasks to call out to external resources',
            groupId: dltEcsSecurityGroup.ref,
            ipProtocol: '-1'
        });

        new CfnSecurityGroupIngress(this, 'DLTSecGroupIngress', {
            description: 'Allow tasks to communicate',
            fromPort: 50000,
            groupId: dltEcsSecurityGroup.ref,
            ipProtocol: 'tcp',
            sourceSecurityGroupId: dltEcsSecurityGroup.ref,
            toPort: 50000
        });
    }
}
