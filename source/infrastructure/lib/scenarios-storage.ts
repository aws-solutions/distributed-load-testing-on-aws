// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Construct, RemovalPolicy, Tags } from '@aws-cdk/core';
import { AttributeType, BillingMode, Table, TableEncryption } from '@aws-cdk/aws-dynamodb';
import { AnyPrincipal, Effect, Policy, PolicyStatement, Role } from '@aws-cdk/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from '@aws-cdk/aws-s3';

/**
 * @interface ScenarioTestRunnerContructProps
 * ScenarioTestRunnerStorageContruct props
 */
export interface ScenarioTestRunnerStorageContructProps {
    // ECS Task Execution Role
    readonly ecsTaskExecutionRole: Role;
    // S3 Logs Bucket
    readonly s3LogsBucket: Bucket;
    // CloudFront domain name
    readonly cloudFrontDomainName: string;
    // Solution Id
    readonly solutionId: string;
}

/**
 * Distributed Load Testing storage construct
 * Creates an S3 bucket to store test scenarios and 
 * a Dynamodb table to store tests and test configuration
 */
export class ScenarioTestRunnerStorageContruct extends Construct {
    public scenariosBucket: Bucket;
    public scenariosS3Policy: Policy;
    public scenariosTable: Table;
    public dynamoDbPolicy: Policy;


    constructor(scope: Construct, id: string, props: ScenarioTestRunnerStorageContructProps) {
        super(scope, id);

        this.scenariosBucket = new Bucket(this, 'DLTScenariosBucket', {
            removalPolicy: RemovalPolicy.RETAIN,
            serverAccessLogsBucket: props.s3LogsBucket,
            serverAccessLogsPrefix: 'scenarios-bucket-access/',
            encryption: BucketEncryption.KMS_MANAGED,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            cors: [
                {
                    allowedMethods: [HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT],
                    allowedOrigins: [`https://${props.cloudFrontDomainName}`],
                    allowedHeaders: ['*'],
                    exposedHeaders: ['ETag']
                }
            ]
        });
        Tags.of(this.scenariosBucket).add('SolutionId', props.solutionId);

        this.scenariosBucket.addToResourcePolicy(new PolicyStatement({
            actions: ['s3:*'],
            resources: [this.scenariosBucket.bucketArn, `${this.scenariosBucket.bucketArn}/*`],
            effect: Effect.DENY,
            principals: [new AnyPrincipal],
            conditions: {
                'Bool': {
                    'aws:SecureTransport': false
                }
            }
        }));

        this.scenariosS3Policy = new Policy(this, 'ScenariosS3Policy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        's3:HeadObject',
                        's3:PutObject',
                        's3:GetObject',
                        's3:ListBucket'
                    ],
                    resources: [
                        this.scenariosBucket.bucketArn,
                        `${this.scenariosBucket.bucketArn}/*`
                    ]
                })
            ]
        });
        props.ecsTaskExecutionRole.attachInlinePolicy(this.scenariosS3Policy);

        this.scenariosTable = new Table(this, 'DLTScenariosTable', {
            billingMode: BillingMode.PAY_PER_REQUEST,
            encryption: TableEncryption.AWS_MANAGED,
            partitionKey: { name: 'testId', type: AttributeType.STRING },
            pointInTimeRecovery: true
        });
        Tags.of(this.scenariosTable).add('SolutionId', props.solutionId);

        this.dynamoDbPolicy = new Policy(this, 'DynamoDbPolicy', {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        'dynamodb:DeleteItem',
                        'dynamodb:GetItem',
                        'dynamodb:PutItem',
                        'dynamodb:Scan',
                        'dynamodb:UpdateItem'
                    ],
                    resources: [this.scenariosTable.tableArn]
                })
            ]
        })
    }
}