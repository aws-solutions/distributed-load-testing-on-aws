// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Duration, CfnResource, Aws, Fn } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Schedule } from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { EventbridgeToLambda } from "@aws-solutions-constructs/aws-eventbridge-lambda";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LambdaToSqsToLambda } from "@aws-solutions-constructs/aws-lambda-sqs-lambda";
import { MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { ILogGroup, QueryDefinition, QueryDefinitionProps } from "aws-cdk-lib/aws-logs";
import { ExecutionDay, MetricDataProps, SolutionsMetricProps } from "../lambda/helpers/types";
import {
  addLambdaBilledDurationMemorySize,
  addCloudFrontMetric,
  addLambdaInvocationCount,
  addECSAverageCPUUtilization,
  addECSAverageMemoryUtilization,
  addDynamoDBConsumedWriteCapacityUnits,
  addDynamoDBConsumedReadCapacityUnits,
} from "./query-builders";

export class SolutionsMetrics extends Construct {
  private metricDataQueries: MetricDataQuery[];
  private eventBridgeRule: CfnResource;
  private metricsLambdaFunction: LambdaFunction;

  constructor(scope: Construct, id: string, props: SolutionsMetricProps) {
    super(scope, id);

    const { SOLUTION_ID, SOLUTION_NAME, CODE_VERSION } = process.env;
    this.metricsLambdaFunction = new LambdaFunction(this, "MetricsLambda", {
      description: "Metrics util",
      code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/metrics-utils.zip`),
      handler: "index.handler",
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(60),
      memorySize: 128,
      environment: {
        QUERY_PREFIX: `${Aws.STACK_NAME}-`,
        SOLUTION_ID: SOLUTION_ID ?? scope.node.tryGetContext("solutionId"),
        SOLUTION_NAME: SOLUTION_NAME ?? scope.node.tryGetContext("solutionName"),
        SOLUTION_VERSION: CODE_VERSION ?? scope.node.tryGetContext("codeVersion"),
        UUID: props.uuid ?? "",
        EXECUTION_DAY: props.executionDay ? props.executionDay : ExecutionDay.MONDAY,
      },
    });

    const ruleToLambda = new EventbridgeToLambda(this, "EventbridgeRuleToLambda", {
      eventRuleProps: {
        schedule: Schedule.cron({
          minute: "0",
          hour: "23",
          weekDay: props.executionDay ? props.executionDay : ExecutionDay.MONDAY,
        }),
      },
      existingLambdaObj: this.metricsLambdaFunction,
    });

    props.queryProps?.map(this.addQueryDefinition.bind(this));

    this.metricDataQueries = [];
    this.eventBridgeRule = ruleToLambda.eventsRule.node.defaultChild as CfnResource;
    props.metricDataProps?.map(this.addMetricDataQuery.bind(this));

    new LambdaToSqsToLambda(this, "LambdaToSqsToLambda", {
      existingConsumerLambdaObj: ruleToLambda.lambdaFunction,
      existingProducerLambdaObj: ruleToLambda.lambdaFunction,
      queueProps: {
        deliveryDelay: Duration.minutes(15),
        visibilityTimeout: Duration.minutes(17),
        receiveMessageWaitTime: Duration.seconds(20),
        retentionPeriod: Duration.days(1),
        maxMessageSizeBytes: 1024,
      },
      deployDeadLetterQueue: false,
    });
  }

  addQueryDefinition(queryDefinitionProps: QueryDefinitionProps): void {
    new QueryDefinition(this, queryDefinitionProps.queryDefinitionName, {
      ...queryDefinitionProps,
      queryDefinitionName: `${Aws.STACK_NAME}-${queryDefinitionProps.queryDefinitionName}`,
    });
    queryDefinitionProps.logGroups?.map((logGroup: ILogGroup) =>
      logGroup.grant(this.metricsLambdaFunction, "logs:StartQuery", "logs:GetQueryResults")
    );
    this.metricsLambdaFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["logs:DescribeQueryDefinitions"],
        resources: ["*"],
      })
    );
  }

  addMetricDataQuery(metricDataProp: MetricDataProps): void {
    if (this.metricDataQueries.length === 0) {
      this.metricsLambdaFunction.addToRolePolicy(
        new PolicyStatement({
          actions: ["cloudwatch:GetMetricData"],
          resources: ["*"],
        })
      );
    }
    this.metricDataQueries.push({
      ...metricDataProp,
      Id: `id_${Fn.join("_", Fn.split("-", Aws.STACK_NAME))}_${this.metricDataQueries.length}`,
    });
    this.eventBridgeRule.addOverride("Properties.Targets.0.InputTransformer", {
      InputPathsMap: {
        time: "$.time",
        "detail-type": "$.detail-type",
      },
      InputTemplate: `{"detail-type": <detail-type>, "time": <time>, "metrics-data-query": ${JSON.stringify(
        this.metricDataQueries
      )}}`,
    });
  }

  addLambdaInvocationCount: typeof addLambdaInvocationCount;
  addLambdaBilledDurationMemorySize: typeof addLambdaBilledDurationMemorySize;
  addCloudFrontMetric: typeof addCloudFrontMetric;
  addECSAverageCPUUtilization: typeof addECSAverageCPUUtilization;
  addECSAverageMemoryUtilization: typeof addECSAverageMemoryUtilization;
  addDynamoDBConsumedWriteCapacityUnits: typeof addDynamoDBConsumedWriteCapacityUnits;
  addDynamoDBConsumedReadCapacityUnits: typeof addDynamoDBConsumedReadCapacityUnits;
}

Object.assign(SolutionsMetrics.prototype, {
  addLambdaInvocationCount,
  addLambdaBilledDurationMemorySize,
  addCloudFrontMetric,
  addECSAverageCPUUtilization,
  addECSAverageMemoryUtilization,
  addDynamoDBConsumedWriteCapacityUnits,
  addDynamoDBConsumedReadCapacityUnits,
});
