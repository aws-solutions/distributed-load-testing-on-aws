// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Aws, CfnResource, Construct, Duration, Stack, Tags } from '@aws-cdk/core';
import { Code, Function as LambdaFunction, Runtime } from '@aws-cdk/aws-lambda';
import { Effect, PolicyStatement, PolicyDocument, Role, ServicePrincipal, Policy } from '@aws-cdk/aws-iam';
import { IBucket } from '@aws-cdk/aws-s3';
import { Table } from '@aws-cdk/aws-dynamodb';
import { LogGroup } from '@aws-cdk/aws-logs';

/**
 * TestRunnerLambdasConstruct props
 * @interface TestRunnerLambdaConstructProps
 */
export interface TestRunnerLambdasContructProps {
    readonly cloudWatchLogsPolicy: Policy;
    // DynamoDB policy
    readonly dynamoDbPolicy: Policy;
    //ECS Task Execution Role ARN
    readonly ecsTaskExecutionRoleArn: string;
    // ECS CloudWatch LogGroup ;
    readonly ecsCloudWatchLogGroup: LogGroup;
    // ECS Cluster
    readonly ecsCluster: string;
    // ECS Task definition
    readonly ecsTaskDefinition: string;
    // ECS Security Group
    readonly ecsTaskSecurityGroup: string;
    // Scenarios S3 Bucket policy
    readonly scenariosS3Policy: Policy;
    // Subnet A Id
    readonly subnetA: string;
    // Subnet B Id
    readonly subnetB: string
    /**
    * Solution config properties.
    * the metric URL endpoint, send anonymous usage, solution ID, version, source code bucket, and source code prefix
    */
    readonly metricsUrl: string;
    readonly sendAnonymousUsage: string;
    readonly solutionId: string;
    readonly solutionVersion: string;
    readonly sourceCodeBucket: IBucket;
    readonly sourceCodePrefix: string;
    // Test scenarios bucket
    readonly testScenariosBucket: string;
    // Test scenarios table
    readonly testScenariosTable: Table;
    // Stack UUID
    readonly uuid: string;
}

/**
* @class
* Distributed Load Testing on AWS Test Runner Lambdas construct.
* This creates the Results parser, Task Runner, Task Canceler, 
* and Task Status Checker
*/
export class TestRunnerLambdasConstruct extends Construct {
    public resultsParser: LambdaFunction;
    public taskRunner: LambdaFunction;
    public taskCanceler: LambdaFunction;
    public taskCancelerInvokePolicy: Policy;
    public taskStatusChecker: LambdaFunction;

    constructor(scope: Construct, id: string, props: TestRunnerLambdasContructProps) {
        super(scope, id);

        const lambdaResultsRole = new Role(this, 'LambdaResultsRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com')
        });
        const cfnPolicy = new Policy(this, 'LambdaResultsPolicy', {
            statements: [
                new PolicyStatement({
                    resources: ['*'],
                    actions: ['cloudwatch:GetMetricWidgetImage']
                })
            ]
        });
        lambdaResultsRole.attachInlinePolicy(cfnPolicy);
        lambdaResultsRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
        lambdaResultsRole.attachInlinePolicy(props.dynamoDbPolicy);
        lambdaResultsRole.attachInlinePolicy(props.scenariosS3Policy);

        const resultsRoleResource = lambdaResultsRole.node.defaultChild as CfnResource;
        resultsRoleResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W12',
                reason: 'The action does not support resource level permissions.'
            }]
        });
        const resultsPolicyResource = cfnPolicy.node.defaultChild as CfnResource;
        resultsPolicyResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W12',
                reason: 'The action does not support resource level permissions.'
            }]
        });

        this.resultsParser = new LambdaFunction(this, 'ResultsParser', {
            description: 'Result parser for indexing xml test results to DynamoDB',
            handler: 'index.handler',
            role: lambdaResultsRole,
            code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/results-parser.zip`),
            runtime: Runtime.NODEJS_14_X,
            timeout: Duration.seconds(120),
            environment: {
                SCENARIOS_BUCKET: props.testScenariosBucket,
                SCENARIOS_TABLE: props.testScenariosTable.tableName,
                SOLUTION_ID: props.solutionId,
                UUID: props.uuid,
                VERSION: props.solutionVersion,
                SEND_METRIC: props.sendAnonymousUsage,
                METRIC_URL: props.metricsUrl
            },
        });
        Tags.of(this.resultsParser).add('SolutionId', props.solutionId);
        const resultsParserResource = this.resultsParser.node.defaultChild as CfnResource;
        resultsParserResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W58',
                reason: 'CloudWatchLogsPolicy covers a permission to write CloudWatch logs.'
            }, {
                id: 'W89',
                reason: 'This Lambda function does not require a VPC'
            }, {
                id: 'W92',
                reason: 'Does not run concurrent executions'
            },]
        });

        const taskArn = Stack.of(this).formatArn({ service: 'ecs', resource: 'task', sep: '/', resourceName: '*' });
        const taskDefArn = Stack.of(this).formatArn({ service: 'ecs', resource: 'task-definition', resourceName: '*:*' });

        const lambdaTaskRole = new Role(this, 'DLTTestLambdaTaskRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            inlinePolicies: {
                'TaskLambdaPolicy': new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['ecs:ListTasks'],
                            resources: ['*']
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                'ecs:RunTask',
                                'ecs:DescribeTasks'
                            ],
                            resources: [
                                taskArn,
                                taskDefArn
                            ]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['iam:PassRole'],
                            resources: [props.ecsTaskExecutionRoleArn]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['logs:PutMetricFilter'],
                            resources: [props.ecsCloudWatchLogGroup.logGroupArn]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['cloudwatch:PutDashboard'],
                            resources: [
                                `arn:${Aws.PARTITION}:cloudwatch::${Aws.ACCOUNT_ID}:dashboard/EcsLoadTesting*`
                            ]
                        })
                    ]
                })
            }
        });
        lambdaTaskRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
        lambdaTaskRole.attachInlinePolicy(props.dynamoDbPolicy);

        const lambdaTaskRoleResource = lambdaTaskRole.node.defaultChild as CfnResource;
        lambdaTaskRoleResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W11',
                reason: 'ecs:ListTasks does not support resource level permissions'
            }]
        });

        this.taskRunner = new LambdaFunction(this, 'TaskRunner', {
            description: 'Task runner for ECS task definitions',
            handler: 'index.handler',
            role: lambdaTaskRole,
            code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/task-runner.zip`),
            environment: {
                SCENARIOS_BUCKET: props.testScenariosBucket,
                SCENARIOS_TABLE: props.testScenariosTable.tableName,
                TASK_CLUSTER: props.ecsCluster,
                TASK_DEFINITION: props.ecsTaskDefinition,
                TASK_SECURITY_GROUP: props.ecsTaskSecurityGroup,
                TASK_IMAGE: `${Aws.STACK_NAME}-load-tester`,
                SUBNET_A: props.subnetA,
                SUBNET_B: props.subnetB,
                API_INTERVAL: '10',
                ECS_LOG_GROUP: props.ecsCloudWatchLogGroup.logGroupName,
                SOLUTION_ID: props.solutionId,
                VERSION: props.solutionVersion
            },
            runtime: Runtime.NODEJS_14_X,
            timeout: Duration.seconds(900)
        });
        Tags.of(this.taskRunner).add('SolutionId', props.solutionId);
        const taskRunnerResource = this.taskRunner.node.defaultChild as CfnResource;
        taskRunnerResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W58',
                reason: 'CloudWatchLogsPolicy covers a permission to write CloudWatch logs.'
            }, {
                id: 'W89',
                reason: 'This Lambda function does not require a VPC'
            }, {
                id: 'W92',
                reason: 'Does not run concurrent executions'
            }]
        });

        const taskCancelerRole = new Role(this, 'LambdaTaskCancelerRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            inlinePolicies: {
                'TaskCancelerPolicy': new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['ecs:ListTasks'],
                            resources: ['*']
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['ecs:StopTask'],
                            resources: [
                                taskArn,
                                taskDefArn
                            ]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['dynamodb:UpdateItem'],
                            resources: [props.testScenariosTable.tableArn]
                        })
                    ]
                })
            }
        });
        taskCancelerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

        const taskCancelerRoleResource = taskCancelerRole.node.defaultChild as CfnResource;
        taskCancelerRoleResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W11',
                reason: 'ecs:ListTasks does not support resource level permissions'
            }]
        });

        this.taskCanceler = new LambdaFunction(this, 'TaskCanceler', {
            description: 'Stops ECS task',
            handler: 'index.handler',
            role: taskCancelerRole,
            code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/task-canceler.zip`),
            runtime: Runtime.NODEJS_14_X,
            timeout: Duration.seconds(300),
            environment: {
                METRIC_URL: props.metricsUrl,
                SOLUTION_ID: props.solutionId,
                VERSION: props.solutionVersion,
                SCENARIOS_TABLE: props.testScenariosTable.tableName,
                TASK_CLUSTER: props.ecsCluster
            }
        });
        Tags.of(this.taskCanceler).add('SolutionId', props.solutionId);
        const taskCancelerResource = this.taskCanceler.node.defaultChild as CfnResource;
        taskCancelerResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W58',
                reason: 'CloudWatchLogsPolicy covers a permission to write CloudWatch logs.'
            }, {
                id: 'W89',
                reason: 'This Lambda function does not require a VPC'
            }, {
                id: 'W92',
                reason: 'Does not run concurrent executions'
            }]
        });

        this.taskCancelerInvokePolicy = new Policy(this, 'TaskCancelerInvokePolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['lambda:InvokeFunction'],
                    resources: [this.taskCanceler.functionArn]
                })
            ]
        })

        const taskStatusCheckerRole = new Role(this, 'TaskStatusRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            inlinePolicies: {
                'TaskStatusPolicy': new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['ecs:ListTasks'],
                            resources: ['*']
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['ecs:DescribeTasks'],
                            resources: [
                                taskArn
                            ]
                        })
                    ]
                })
            }
        });
        taskStatusCheckerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
        taskStatusCheckerRole.attachInlinePolicy(this.taskCancelerInvokePolicy);
        taskStatusCheckerRole.attachInlinePolicy(props.dynamoDbPolicy);

        const taskStatusCheckerRoleResource = taskStatusCheckerRole.node.defaultChild as CfnResource;
        taskStatusCheckerRoleResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W11',
                reason: 'ecs:ListTasks does not support resource level permissions'
            }, {
                id: 'W58',
                reason: 'CloudWatchLogsPolicy covers a permission to write CloudWatch logs.'
            }]
        });

        this.taskStatusChecker = new LambdaFunction(this, 'TaskStatusChecker', {
            description: 'Task status checker',
            handler: 'index.handler',
            role: taskStatusCheckerRole,
            code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/task-status-checker.zip`),
            runtime: Runtime.NODEJS_14_X,
            timeout: Duration.seconds(180),
            environment: {
                TASK_CLUSTER: props.ecsCluster,
                SCENARIOS_TABLE: props.testScenariosTable.tableName,
                TASK_CANCELER_ARN: this.taskCanceler.functionArn,
                SOLUTION_ID: props.solutionId,
                VERSION: props.solutionVersion
            }
        });
        Tags.of(this.taskStatusChecker).add('SolutionId', props.solutionId);
        const taskStatusCheckerResource = this.taskStatusChecker.node.defaultChild as CfnResource;
        taskStatusCheckerResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W58',
                reason: 'CloudWatchLogsPolicy covers a permission to write CloudWatch logs.'
            }, {
                id: 'W89',
                reason: 'This Lambda function does not require a VPC'
            }, {
                id: 'W92',
                reason: 'Does not run concurrent executions'
            },]
        });
    }
}