// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ArnFormat, CfnResource, Duration, Stack } from "aws-cdk-lib";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement, PolicyDocument, Role, ServicePrincipal, Policy } from "aws-cdk-lib/aws-iam";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { LogGroup, FilterPattern } from "aws-cdk-lib/aws-logs";
import { LambdaDestination } from "aws-cdk-lib/aws-logs-destinations";
import { Construct } from "constructs";

export interface RealTimeDataConstructProps {
  readonly cloudWatchLogsPolicy: Policy;
  readonly ecsCloudWatchLogGroup: LogGroup;
  readonly iotEndpoint: string;
  readonly mainRegion: string;
  /**
   * Solution config properties.
   * solution ID, version, source code bucket, and source code prefix
   */
  readonly solutionId: string;
  readonly solutionVersion: string;
  readonly sourceCodeBucket: IBucket;
  readonly sourceCodePrefix: string;
}

export class RealTimeDataConstruct extends Construct {
  constructor(scope: Construct, id: string, props: RealTimeDataConstructProps) {
    super(scope, id);

    const realTimeDataPublisherRole = new Role(this, "realTimeDataPublisherRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        IoTPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iot:Publish"],
              resources: [
                Stack.of(this).formatArn({
                  region: props.mainRegion,
                  service: "iot",
                  resource: "topic",
                  resourceName: "*",
                  arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                }),
              ],
            }),
          ],
        }),
      },
    });
    realTimeDataPublisherRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    const realTimeDataPublisher = new LambdaFunction(this, "RealTimeDataPublisher", {
      description: "Real time data publisher",
      handler: "index.handler",
      role: realTimeDataPublisherRole,
      code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/real-time-data-publisher.zip`),
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(180),
      environment: {
        MAIN_REGION: props.mainRegion,
        IOT_ENDPOINT: props.iotEndpoint,
        SOLUTION_ID: props.solutionId,
        VERSION: props.solutionVersion,
      },
    });

    const realTimeDataPublisherResource = realTimeDataPublisher.node.defaultChild as CfnResource;
    realTimeDataPublisherResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W58",
          reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs.",
        },
        {
          id: "W89",
          reason: "This Lambda function does not require a VPC",
        },
        {
          id: "W92",
          reason: "Does not run concurrent executions",
        },
      ],
    });

    const ecsCloudWatchSubscriptionFilter = props.ecsCloudWatchLogGroup.addSubscriptionFilter(
      "ECSLogSubscriptionFilter",
      {
        destination: new LambdaDestination(realTimeDataPublisher),
        filterPattern: FilterPattern.allTerms("INFO: Current:", "live=true"),
      }
    );
    const subscriptionFilterPermission = ecsCloudWatchSubscriptionFilter.node.findChild("CanInvokeLambda");
    if (subscriptionFilterPermission != null)
      ecsCloudWatchSubscriptionFilter.node.addDependency(subscriptionFilterPermission);
  }
}
