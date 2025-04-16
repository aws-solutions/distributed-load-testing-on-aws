// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ArnFormat, CfnResource, Duration, Stack } from "aws-cdk-lib";
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { ILogGroup } from "aws-cdk-lib/aws-logs";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface CustomResourceInfraConstructProps {
  readonly cloudWatchPolicy: Policy;
  readonly consoleBucketArn?: string;
  readonly mainStackRegion: string;
  readonly metricsUrl: string;
  readonly scenariosS3Bucket: string;
  readonly scenariosTable: string;
  readonly solutionId: string;
  readonly solutionVersion: string;
  readonly sourceCodeBucket: IBucket;
  readonly sourceCodePrefix: string;
  readonly stackType: string;
}

/**
 * Distributed Load Testing on AWS Custom Resources Construct.
 * It creates a custom resource Lambda function.
 */
export class CustomResourceInfraConstruct extends Construct {
  public customResourceArn: string;
  public customResourceLambdaLogGroup: ILogGroup;
  public customResourceLambdaFunctionName: string;

  constructor(scope: Construct, id: string, props: CustomResourceInfraConstructProps) {
    super(scope, id);

    const sourceBucket = props.sourceCodeBucket;
    const sourceBucketArn = sourceBucket.arnForObjects("*");

    const scenariosBucket = Bucket.fromBucketName(this, "ScenariosBucket", props.scenariosS3Bucket);
    const scenariosBucketObjectArn = scenariosBucket.arnForObjects("*");

    const scenariosTableArn = Stack.of(this).formatArn({
      service: "dynamodb",
      region: props.mainStackRegion,
      resource: "table",
      resourceName: props.scenariosTable,
    });

    const customResourceRole = new Role(this, "CustomResourceLambdaRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        CustomResourcePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [sourceBucketArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:PutObject", "s3:DeleteObject"],
              resources: [scenariosBucketObjectArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:PutItem", "dynamodb:DeleteItem"],
              resources: [scenariosTableArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iot:DescribeEndpoint", "iot:DetachPrincipalPolicy"],
              resources: ["*"],
            }),
            new PolicyStatement({
              actions: ["iot:ListTargetsForPolicy"],
              effect: Effect.ALLOW,
              resources: [
                Stack.of(this).formatArn({
                  service: "iot",
                  resource: "policy",
                  resourceName: "*",
                  arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                }),
              ],
            }),
          ],
        }),
      },
    });

    customResourceRole.attachInlinePolicy(props.cloudWatchPolicy);
    const cfnCustomResourceRole = customResourceRole.node.defaultChild as CfnResource;
    cfnCustomResourceRole.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "iot:DescribeEndpoint and iot:DetachPrincipalPolicy cannot specify the resource.",
        },
      ],
    });

    const customResourceLambda = new LambdaFunction(this, "CustomResourceLambda", {
      description: "CFN Lambda backed custom resource to deploy assets to s3",
      handler: "index.handler",
      role: customResourceRole,
      code: Code.fromBucket(sourceBucket, `${props.sourceCodePrefix}/${props.stackType}-custom-resource.zip`),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(120),
      environment: {
        METRIC_URL: props.metricsUrl,
        SOLUTION_ID: props.solutionId,
        VERSION: props.solutionVersion,
        MAIN_REGION: props.mainStackRegion,
        DDB_TABLE: props.scenariosTable,
        S3_BUCKET: props.scenariosS3Bucket,
      },
    });

    if (props.stackType === "main") {
      customResourceLambda.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:PutObject"],
          resources: [`${props.consoleBucketArn}`, `${props.consoleBucketArn}/*`],
        })
      );
    }

    this.customResourceArn = customResourceLambda.functionArn;
    this.customResourceLambdaFunctionName = customResourceLambda.functionName;

    const customResource = customResourceLambda.node.defaultChild as CfnResource;
    customResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W58",
          reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs.",
        },
        {
          id: "W89",
          reason: "VPC not needed for lambda",
        },
        {
          id: "W92",
          reason: "Does not run concurrent executions",
        },
      ],
    });
  }
}
