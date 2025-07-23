// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { ArnFormat, CfnResource, Duration, Stack } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement, PolicyDocument, Role, ServicePrincipal, Policy } from "aws-cdk-lib/aws-iam";
import { LogGroup, FilterPattern, ILogGroup } from "aws-cdk-lib/aws-logs";
import { LambdaDestination } from "aws-cdk-lib/aws-logs-destinations";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Solution } from "../../bin/solution";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

export interface RealTimeDataConstructProps {
  readonly cloudWatchLogsPolicy: Policy;
  readonly ecsCloudWatchLogGroup: LogGroup;
  readonly iotEndpoint: string;
  readonly mainRegion: string;
  readonly solution: Solution;
}

export class RealTimeDataConstruct extends Construct {
  public realTimeDataPublisher: NodejsFunction;
  public realTimeDataPublisherLogGroup: ILogGroup;
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

    addCfnGuardSuppression(realTimeDataPublisherRole, "IAM_NO_INLINE_POLICY_CHECK");

    realTimeDataPublisherRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    const realTimeDataPublisher = new NodejsFunction(this, "RealTimeDataPublisherNew", {
      description: "Real time data publisher",
      handler: "index.handler",
      role: realTimeDataPublisherRole,
      entry: path.join(__dirname, "../../../real-time-data-publisher/index.js"),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(180),
      environment: {
        MAIN_REGION: props.mainRegion,
        IOT_ENDPOINT: `https://${props.iotEndpoint}`,
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
      },
    });

    const realTimeDataPublisherLogGroup = new LogGroup(this, "RealTimeDataPublisherLogGroup", {
      logGroupName: `/aws/lambda/${realTimeDataPublisher.functionName}`,
    });

    this.realTimeDataPublisherLogGroup = realTimeDataPublisherLogGroup;

    const realTimeDataPublisherLogGroupResource = realTimeDataPublisherLogGroup.node.defaultChild as CfnResource;
    realTimeDataPublisherLogGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W84",
          reason: "KMS encryption unnecessary for log group",
        },
      ],
    });

    this.realTimeDataPublisher = realTimeDataPublisher;

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
