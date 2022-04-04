// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Aws, CfnCondition, CfnCustomResource, CfnResource, Construct, CustomResource, Duration, RemovalPolicy, Stack, Tags } from '@aws-cdk/core';
import { BlockPublicAccess, Bucket, BucketAccessControl, BucketEncryption, IBucket } from '@aws-cdk/aws-s3';
import { AnyPrincipal, Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { Code, Function as LambdaFunction, Runtime } from '@aws-cdk/aws-lambda';

/**
 * CommonResourcesContruct props
 * @interface CommonResourcesContructProps
 */
export interface CommonResourcesContructProps {
  // ECS Task Execution Role
  dltEcsTaskExecutionRole: Role;
  // Solution ID
  readonly solutionId: string;
  //Source Code Bucket
  readonly sourceCodeBucket: string;
  // Source code prefix
  readonly sourceCodePrefix: string;
  // Solution Version
  readonly solutionVersion: string;
  // Send anonymous metrics condition:
  readonly sendAnonymousUsageCondition: CfnCondition;
  // Metrics URL
  readonly metricsUrl: string;
  // create VPC resources condition logical ID
  readonly existingVpc: string;
}

/**
 * @class
 * Distributed Load Testing on AWS common resources construct.
 * Creates a CloudWatch logs policy and an S3 bucket to store logs.
 */
export class CommonResourcesContruct extends Construct {
  // CloudWatch Logs Policy
  public cloudWatchLogsPolicy: Policy;
  // Custom Resource Role
  public customResourceRole: Role;
  //Custom Resource lambda
  public customResourceLambda: LambdaFunction;
  //S3 Logs Bucket
  public s3LogsBucket: Bucket;
  // Code S3 Bucket
  public sourceBucket: IBucket;
  // Generated UUID
  public uuid: string;

  constructor(scope: Construct, id: string, props: CommonResourcesContructProps) {
    super(scope, id);

    const logGroupResourceArn = Stack.of(this).formatArn({ service: 'logs', resource: 'log-group:', resourceName: 'aws/lambda/*' })
    this.cloudWatchLogsPolicy = new Policy(this, 'CloudWatchLogsPolicy', {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [
            logGroupResourceArn
          ]
        })
      ]
    });

    props.dltEcsTaskExecutionRole.attachInlinePolicy(this.cloudWatchLogsPolicy);

    this.s3LogsBucket = new Bucket(this, 'LogsBucket', {
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN
    });
    Tags.of(this.s3LogsBucket).add('SolutionId', props.solutionId);

    this.s3LogsBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:*'],
        conditions: {
          Bool: { 'aws:SecureTransport': 'false' }
        },
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        resources: [this.s3LogsBucket.bucketArn, this.s3LogsBucket.arnForObjects('*')]
      })
    );

    const s3LogsBucketResource = this.s3LogsBucket.node.defaultChild as CfnResource;
    s3LogsBucketResource.addMetadata('cfn_nag', {
      rules_to_suppress: [{
        id: 'W35',
        reason: 'This is the logging bucket, it does not require logging.'
      }]
    })

    this.sourceBucket = Bucket.fromBucketName(this, 'SourceCodeBucket', props.sourceCodeBucket);
    const sourceBucketArn = this.sourceBucket.arnForObjects('*');

    const customResourceRole = new Role(this, 'CustomResourceLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'CustomResourcePolicy': new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['s3:GetObject'],
              resources: [
                sourceBucketArn
              ]
            })
          ]
        })
      }
    });
    customResourceRole.attachInlinePolicy(this.cloudWatchLogsPolicy);

    this.customResourceLambda = new LambdaFunction(this, 'CustomResourceLambda', {
      description: 'CFN Lambda backed custom resource to deploy assets to s3',
      handler: 'index.handler',
      role: customResourceRole,
      code: Code.fromBucket(this.sourceBucket, `${props.sourceCodePrefix}/custom-resource.zip`),
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.seconds(120),
      environment: {
        METRIC_URL: props.metricsUrl,
        SOLUTION_ID: props.solutionId,
        VERSION: props.solutionVersion
      }
    });

    Tags.of(this.customResourceLambda).add('SolutionId', props.solutionId);
    const customResource = this.customResourceLambda.node.defaultChild as CfnResource;
    customResource.addMetadata('cfn_nag', {
      rules_to_suppress: [{
        id: 'W58',
        reason: 'CloudWatchLogsPolicy covers a permission to write CloudWatch logs.'
      }, {
        id: 'W89',
        reason: 'VPC not needed for lambda'
      }, {
        id: 'W92',
        reason: 'Does not run concurrent executions'
      },]
    })

    const uuidGenerator = new CustomResource(this, 'UUID', {
      serviceToken: this.customResourceLambda.functionArn,
      resourceType: 'Custom::UUID',
      properties: {
        Resource: 'UUID'
      }
    });

    this.uuid = uuidGenerator.getAtt('UUID').toString();


    const sendAnonymousMetrics = new CustomResource(this, 'AnonymousMetric', {
      serviceToken: this.customResourceLambda.functionArn,
      resourceType: 'Custom::AnonymousMetric',
      properties: {
        Resource: 'AnonymousMetric',
        Region: Aws.REGION,
        SolutionId: props.solutionId,
        UUID: this.uuid,
        VERSION: props.solutionVersion,
        existingVPC: props.existingVpc
      }
    });
    const cfnSendAnonymousMetrics = sendAnonymousMetrics.node.defaultChild as CfnCustomResource;
    cfnSendAnonymousMetrics.cfnOptions.condition = props.sendAnonymousUsageCondition;
  }
}