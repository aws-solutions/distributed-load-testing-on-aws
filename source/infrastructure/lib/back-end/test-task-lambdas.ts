// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ArnFormat, Aws, CfnResource, Duration, Stack } from "aws-cdk-lib";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement, PolicyDocument, Role, ServicePrincipal, Policy } from "aws-cdk-lib/aws-iam";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface TestRunnerLambdasConstructProps {
  readonly cloudWatchLogsPolicy: Policy;
  // ECS Task Execution Role ARN
  readonly ecsTaskExecutionRoleArn: string;
  // ECS CloudWatch LogGroup
  readonly ecsCloudWatchLogGroup: LogGroup;
  // ECS Cluster
  readonly ecsCluster: string;
  // ECS Task definition
  readonly ecsTaskDefinition: string;
  // ECS Security Group
  readonly ecsTaskSecurityGroup: string;
  // Table storing historical test data
  readonly historyTable: Table;
  // History DynamoDB table policy
  readonly historyDynamoDbPolicy: Policy;
  // Scenarios S3 Bucket policy
  readonly scenariosS3Policy: Policy;
  // Subnet A Id
  readonly subnetA: string;
  // Subnet B Id
  readonly subnetB: string;
  // Test scenarios bucket
  readonly scenariosBucket: string;
  // Test scenarios table
  readonly scenariosTable: Table;
  // Scenario DynamoDB table policy
  readonly scenariosDynamoDbPolicy: Policy;
  /**
   * Solution config properties.
   * the metric URL endpoint, send anonymized usage, solution ID, version, source code bucket, and source code prefix
   */
  readonly metricsUrl: string;
  readonly sendAnonymizedUsage: string;
  readonly solutionId: string;
  readonly solutionVersion: string;
  readonly sourceCodeBucket: IBucket;
  readonly sourceCodePrefix: string;
  readonly uuid: string;
  readonly mainStackRegion: string;
}

/**
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
  public realTimeDataPublisher: LambdaFunction;

  constructor(scope: Construct, id: string, props: TestRunnerLambdasConstructProps) {
    super(scope, id);

    const ecsLogGroupArn = props.ecsCloudWatchLogGroup.logGroupArn;
    const lambdaResultsRole = new Role(this, "LambdaResultsRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });
    const cfnPolicy = new Policy(this, "LambdaResultsPolicy", {
      statements: [
        new PolicyStatement({
          resources: ["*"],
          actions: ["cloudwatch:GetMetricWidgetImage"],
        }),
        new PolicyStatement({
          resources: [ecsLogGroupArn],
          actions: ["logs:DeleteMetricFilter"],
        }),
      ],
    });

    lambdaResultsRole.attachInlinePolicy(cfnPolicy);
    lambdaResultsRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
    lambdaResultsRole.attachInlinePolicy(props.scenariosDynamoDbPolicy);
    lambdaResultsRole.attachInlinePolicy(props.historyDynamoDbPolicy);
    lambdaResultsRole.attachInlinePolicy(props.scenariosS3Policy);

    const resultsRoleResource = lambdaResultsRole.node.defaultChild as CfnResource;
    resultsRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W12",
          reason: "The action does not support resource level permissions.",
        },
      ],
    });
    const resultsPolicyResource = cfnPolicy.node.defaultChild as CfnResource;
    resultsPolicyResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W12",
          reason: "The action does not support resource level permissions.",
        },
      ],
    });

    this.resultsParser = new LambdaFunction(this, "ResultsParser", {
      description: "Result parser for indexing xml test results to DynamoDB",
      handler: "index.handler",
      role: lambdaResultsRole,
      code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/results-parser.zip`),
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(120),
      environment: {
        HISTORY_TABLE: props.historyTable.tableName,
        METRIC_URL: props.metricsUrl,
        SCENARIOS_BUCKET: props.scenariosBucket,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        SEND_METRIC: props.sendAnonymizedUsage,
        SOLUTION_ID: props.solutionId,
        UUID: props.uuid,
        VERSION: props.solutionVersion,
      },
    });
    const resultsParserResource = this.resultsParser.node.defaultChild as CfnResource;
    resultsParserResource.addMetadata("cfn_nag", {
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

    const taskArn = Stack.of(this).formatArn({
      service: "ecs",
      resource: "task",
      resourceName: "*",
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
    const taskDefArn = Stack.of(this).formatArn({ service: "ecs", resource: "task-definition", resourceName: "*:*" });

    const lambdaTaskRole = new Role(this, "DLTTestLambdaTaskRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        TaskLambdaPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:ListTasks"],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:RunTask", "ecs:DescribeTasks", "ecs:TagResource"],
              resources: [taskArn, taskDefArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: [props.ecsTaskExecutionRoleArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["logs:PutMetricFilter"],
              resources: [ecsLogGroupArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cloudwatch:PutDashboard"],
              resources: [`arn:${Aws.PARTITION}:cloudwatch::${Aws.ACCOUNT_ID}:dashboard/EcsLoadTesting*`],
            }),
          ],
        }),
      },
    });
    lambdaTaskRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
    lambdaTaskRole.attachInlinePolicy(props.scenariosDynamoDbPolicy);

    const lambdaTaskRoleResource = lambdaTaskRole.node.defaultChild as CfnResource;
    lambdaTaskRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "ecs:ListTasks does not support resource level permissions",
        },
      ],
    });

    this.taskRunner = new LambdaFunction(this, "TaskRunner", {
      description: "Task runner for ECS task definitions",
      handler: "index.handler",
      role: lambdaTaskRole,
      code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/task-runner.zip`),
      environment: {
        SCENARIOS_BUCKET: props.scenariosBucket,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        SOLUTION_ID: props.solutionId,
        VERSION: props.solutionVersion,
        MAIN_STACK_REGION: props.mainStackRegion,
      },
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(900),
    });
    const taskRunnerResource = this.taskRunner.node.defaultChild as CfnResource;
    taskRunnerResource.addMetadata("cfn_nag", {
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

    const taskCancelerRole = new Role(this, "LambdaTaskCancelerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        TaskCancelerPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:ListTasks"],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:StopTask"],
              resources: [taskArn, taskDefArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:UpdateItem"],
              resources: [props.scenariosTable.tableArn],
            }),
          ],
        }),
      },
    });
    taskCancelerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    const taskCancelerRoleResource = taskCancelerRole.node.defaultChild as CfnResource;
    taskCancelerRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "ecs:ListTasks does not support resource level permissions",
        },
      ],
    });

    this.taskCanceler = new LambdaFunction(this, "TaskCanceler", {
      description: "Stops ECS task",
      handler: "index.handler",
      role: taskCancelerRole,
      code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/task-canceler.zip`),
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(300),
      environment: {
        METRIC_URL: props.metricsUrl,
        SOLUTION_ID: props.solutionId,
        VERSION: props.solutionVersion,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
      },
    });
    const taskCancelerResource = this.taskCanceler.node.defaultChild as CfnResource;
    taskCancelerResource.addMetadata("cfn_nag", {
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

    this.taskCancelerInvokePolicy = new Policy(this, "TaskCancelerInvokePolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["lambda:InvokeFunction"],
          resources: [this.taskCanceler.functionArn],
        }),
      ],
    });

    const taskStatusCheckerRole = new Role(this, "TaskStatusRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        TaskStatusPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:ListTasks"],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:DescribeTasks"],
              resources: [taskArn],
            }),
          ],
        }),
      },
    });
    taskStatusCheckerRole.attachInlinePolicy(this.taskCancelerInvokePolicy);
    taskStatusCheckerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
    taskStatusCheckerRole.attachInlinePolicy(props.scenariosDynamoDbPolicy);

    const taskStatusCheckerRoleResource = taskStatusCheckerRole.node.defaultChild as CfnResource;
    taskStatusCheckerRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "ecs:ListTasks does not support resource level permissions",
        },
      ],
    });

    this.taskStatusChecker = new LambdaFunction(this, "TaskStatusChecker", {
      description: "Task status checker",
      handler: "index.handler",
      role: taskStatusCheckerRole,
      code: Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/task-status-checker.zip`),
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(180),
      environment: {
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        TASK_CANCELER_ARN: this.taskCanceler.functionArn,
        SOLUTION_ID: props.solutionId,
        VERSION: props.solutionVersion,
      },
    });
    const taskStatusCheckerResource = this.taskStatusChecker.node.defaultChild as CfnResource;
    taskStatusCheckerResource.addMetadata("cfn_nag", {
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
  }
}
