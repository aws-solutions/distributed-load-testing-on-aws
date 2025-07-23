// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { Aws, CfnResource, Duration } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement, PolicyDocument, Role, ServicePrincipal, Policy } from "aws-cdk-lib/aws-iam";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { LogGroup, ILogGroup } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../../bin/solution";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

export interface TestRunnerLambdasConstructProps {
  readonly cloudWatchLogsPolicy: Policy;
  // ECS Task Execution Role ARN
  readonly ecsTaskExecutionRoleArn: string;
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
  // Test scenarios bucket ARN
  readonly scenariosBucketArn: string;
  // Test scenarios table
  readonly scenariosTable: Table;
  // Scenario DynamoDB table policy
  readonly scenariosDynamoDbPolicy: Policy;
  /**
   * Solution config properties.
   * the metric URL endpoint, send anonymized usage, solution ID, version, source code bucket, and source code prefix
   */
  readonly sendAnonymizedUsage: string;
  readonly solution: Solution;
  readonly uuid: string;
  readonly mainStackRegion: string;
}

/**
 * Distributed Load Testing on AWS Test Runner Lambdas construct.
 * This creates the Results parser, Task Runner, Task Canceler,
 * and Task Status Checker
 */
export class TestRunnerLambdasConstruct extends Construct {
  public resultsParser: NodejsFunction;
  public taskRunner: NodejsFunction;
  public taskCanceler: NodejsFunction;
  public taskCancelerInvokePolicy: Policy;
  public taskStatusChecker: NodejsFunction;
  public realTimeDataPublisher: NodejsFunction;
  public resultsParserLambdaLogGroup: ILogGroup;
  public taskRunnerLambdaLogGroup: ILogGroup;
  public taskCancelerLambdaLogGroup: ILogGroup;
  public taskStatusCheckerLambdaLogGroup: ILogGroup;
  public lambdaTaskRole: Role;

  constructor(scope: Construct, id: string, props: TestRunnerLambdasConstructProps) {
    super(scope, id);

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
          resources: ["*"],
          actions: ["logs:DeleteMetricFilter"],
          conditions: {
            StringEquals: {
              "aws:ResourceTag/SolutionId": props.solution.id,
            },
          },
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

    addCfnGuardSuppression(lambdaResultsRole, "IAM_NO_INLINE_POLICY_CHECK");

    const resultsPolicyResource = cfnPolicy.node.defaultChild as CfnResource;
    resultsPolicyResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W12",
          reason: "The action does not support resource level permissions.",
        },
      ],
    });

    this.resultsParser = new NodejsFunction(this, "ResultsParserNew", {
      description: "Result parser for indexing xml test results to DynamoDB",
      role: lambdaResultsRole,
      entry: path.join(__dirname, "../../../results-parser/index.js"),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(120),
      environment: {
        HISTORY_TABLE: props.historyTable.tableName,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SCENARIOS_BUCKET: props.scenariosBucket,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        SEND_METRIC: props.sendAnonymizedUsage,
        SOLUTION_ID: props.solution.id,
        UUID: props.uuid,
        VERSION: props.solution.version,
      },
    });

    const resultsParserLambdaLogGroup = new LogGroup(this, "ResultsParserLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.resultsParser.functionName}`,
    });

    this.resultsParserLambdaLogGroup = resultsParserLambdaLogGroup;
    const resultsParserLambdaLogGroupResource = resultsParserLambdaLogGroup.node.defaultChild as CfnResource;
    resultsParserLambdaLogGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W84",
          reason: "KMS encryption unnecessary for log group",
        },
      ],
    });

    addCfnGuardSuppression(resultsParserLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");

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

    this.lambdaTaskRole = new Role(this, "DLTTestLambdaTaskRole", {
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
              actions: ["ecs:RunTask", "ecs:DescribeTasks", "ecs:TagResource", "logs:PutMetricFilter"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:putObject"],
              resources: [`${props.scenariosBucketArn}/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:putObject"],
              resources: [`${props.scenariosBucketArn}/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:putObject"],
              resources: [`${props.scenariosBucketArn}/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:putObject"],
              resources: [`${props.scenariosBucketArn}/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: [props.ecsTaskExecutionRoleArn],
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
    this.lambdaTaskRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
    this.lambdaTaskRole.attachInlinePolicy(props.scenariosDynamoDbPolicy);

    const lambdaTaskRoleResource = this.lambdaTaskRole.node.defaultChild as CfnResource;
    lambdaTaskRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "ecs:ListTasks does not support resource level permissions",
        },
      ],
    });

    addCfnGuardSuppression(this.lambdaTaskRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.taskRunner = new NodejsFunction(this, "TaskRunnerNew", {
      description: "Task runner for ECS task definitions",
      role: this.lambdaTaskRole,
      entry: path.join(__dirname, "../../../task-runner/index.js"),
      environment: {
        SCENARIOS_BUCKET: props.scenariosBucket,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        MAIN_STACK_REGION: props.mainStackRegion,
      },
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(900),
    });

    const taskRunnerLambdaLogGroup = new LogGroup(this, "TaskRunnerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.taskRunner.functionName}`,
    });

    addCfnGuardSuppression(taskRunnerLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");

    this.taskRunnerLambdaLogGroup = taskRunnerLambdaLogGroup;

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
              actions: ["ecs:StopTask"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:ListTasks"],
              resources: ["*"],
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

    addCfnGuardSuppression(taskCancelerRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.taskCanceler = new NodejsFunction(this, "TaskCancelerNew", {
      description: "Stops ECS task",
      role: taskCancelerRole,
      entry: path.join(__dirname, "../../../task-canceler/index.js"),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(300),
      environment: {
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
      },
    });

    const taskCancelerLambdaLogGroup = new LogGroup(this, "TaskCancellerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.taskCanceler.functionName}`,
    });

    addCfnGuardSuppression(taskCancelerLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");

    this.taskCancelerLambdaLogGroup = taskCancelerLambdaLogGroup;
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
              actions: ["ecs:DescribeTasks", "ecs:ListTasks"],
              resources: ["*"],
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

    addCfnGuardSuppression(taskStatusCheckerRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.taskStatusChecker = new NodejsFunction(this, "TaskStatusCheckerNew", {
      description: "Task status checker",
      role: taskStatusCheckerRole,
      entry: path.join(__dirname, "../../../task-status-checker/index.js"),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(180),
      environment: {
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        TASK_CANCELER_ARN: this.taskCanceler.functionArn,
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
      },
    });

    const taskStatusCheckerLambdaLogGroup = new LogGroup(this, "taskStatusCheckerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.taskStatusChecker.functionName}`,
    });

    this.taskStatusCheckerLambdaLogGroup = taskStatusCheckerLambdaLogGroup;
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

    addCfnGuardSuppression(taskStatusCheckerLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
  }
}
