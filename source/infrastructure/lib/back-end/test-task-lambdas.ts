// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource, Duration } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaFunctionTarget } from "aws-cdk-lib/aws-events-targets";
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ILogGroup, LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../../bin/solution";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

export interface TestRunnerLambdasConstructProps {
  readonly cloudWatchLogsPolicy: Policy;
  // ECS Task Execution Role ARN
  readonly ecsTaskExecutionRoleArn: string;
  // ECS Task Role ARN
  readonly ecsTaskRoleArn: string;
  // ECS Cluster
  readonly ecsCluster: string;
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
   * the metric URL endpoint, solution ID, version, source code bucket, and source code prefix
   */
  readonly solution: Solution;
  readonly uuid: string;
  readonly mainStackRegion: string;
  // ECS CloudWatch log group name (for metric filters)
  readonly ecsCloudWatchLogGroup: string;
}

/**
 * Distributed Load Testing on AWS Test Runner Lambdas construct.
 * This creates the Results parser, Task Runner, Task Canceler,
 * Task Status Checker, and the orchestration Lambdas:
 * Start Command, Stabilization Checker, Regional Sync,
 * Task Failure Handler, Orphan Cleanup, and SFN Failure Handler.
 */
export class TestRunnerLambdasConstruct extends Construct {
  public resultsParser: NodejsFunction;
  public taskRunner: NodejsFunction;
  public taskCanceler: NodejsFunction;
  public taskCancelerInvokePolicy: Policy;
  public testCleanup: NodejsFunction;
  public testCleanupInvokePolicy: Policy;
  public taskStatusChecker: NodejsFunction;
  public realTimeDataPublisher: NodejsFunction;
  public resultsParserLambdaLogGroup: ILogGroup;
  public taskRunnerLambdaLogGroup: ILogGroup;
  public taskCancelerLambdaLogGroup: ILogGroup;
  public testCleanupLambdaLogGroup: ILogGroup;
  public taskStatusCheckerLambdaLogGroup: ILogGroup;
  public lambdaTaskRole: Role;

  // New orchestration Lambdas
  public startCommand: NodejsFunction;
  public stabilizationChecker: NodejsFunction;
  public regionalSync: NodejsFunction;
  public taskFailureHandler: NodejsFunction;
  public orphanCleanup: NodejsFunction;
  public sfnFailureHandler: NodejsFunction;
  public metricsEmitter: NodejsFunction;
  public testStatusUpdater: NodejsFunction;
  public startCommandLambdaLogGroup: ILogGroup;
  public stabilizationCheckerLambdaLogGroup: ILogGroup;
  public regionalSyncLambdaLogGroup: ILogGroup;
  public taskFailureHandlerLambdaLogGroup: ILogGroup;
  public orphanCleanupLambdaLogGroup: ILogGroup;
  public sfnFailureHandlerLambdaLogGroup: ILogGroup;
  public metricsEmitterLambdaLogGroup: ILogGroup;
  public testStatusUpdaterLambdaLogGroup: ILogGroup;

  constructor(scope: Construct, id: string, props: TestRunnerLambdasConstructProps) {
    super(scope, id);

    // ───────────────────────────────────────────────────────
    // Results Parser Lambda
    // ───────────────────────────────────────────────────────
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
      projectRoot: path.join(__dirname, "../../../results-parser"),
      depsLockFilePath: path.join(__dirname, "../../../results-parser/package-lock.json"),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(900),
      memorySize: 1024,
      environment: {
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
        HISTORY_TABLE: props.historyTable.tableName,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SCENARIOS_BUCKET: props.scenariosBucket,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        SOLUTION_ID: props.solution.id,
        UUID: props.uuid,
        VERSION: props.solution.version,
      },
    });

    const resultsParserLambdaLogGroup = new LogGroup(this, "ResultsParserLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.resultsParser.functionName}`,
      retention: RetentionDays.TEN_YEARS,
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

    // ───────────────────────────────────────────────────────
    // Task Runner Lambda
    // ───────────────────────────────────────────────────────
    this.lambdaTaskRole = new Role(this, "DLTTestLambdaTaskRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        // These ECS actions have no resource type in the IAM service
        // authorization reference — aws:ResourceTag conditions cannot
        // be evaluated and are silently ignored, resulting in a deny.
        //
        // ecs:ListTasks evaluates aws:ResourceTag against container-instance
        // resources, which don't exist in Fargate. An ecs:cluster condition
        // would work for the main stack cluster, but regional stacks create
        // clusters with names unknown at main stack deploy time, so we
        // cannot scope the condition. Resource:"*" is required.
        // @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonelasticcontainerservice.html
        EcsUnscopedActionsPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ecs:DescribeTaskDefinition",
                "ecs:DeregisterTaskDefinition",
                "ecs:ListTaskDefinitions",
                "ecs:ListTasks",
              ],
              resources: ["*"],
            }),
          ],
        }),
        // ECS actions that operate on a named resource type (service,
        // task, task-definition, container-instance) and support
        // aws:ResourceTag conditions for tag-based access control.
        EcsTagScopedPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ecs:RegisterTaskDefinition",
                "ecs:DeleteTaskDefinitions",
                "ecs:RunTask",
                "ecs:DescribeTasks",
                "ecs:TagResource",
                "ecs:CreateService",
                "ecs:UpdateService",
                "ecs:DeleteService",
                "ecs:DescribeServices",
                "logs:PutMetricFilter",
                "logs:DescribeMetricFilters",
              ],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
          ],
        }),
        CloudWatchMetricPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "cloudwatch:namespace": "distributed-load-testing",
                },
              },
            }),
          ],
        }),
        S3WritePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:PutObject"],
              resources: [`${props.scenariosBucketArn}/*`],
            }),
          ],
        }),
        IamPassRolePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: [props.ecsTaskExecutionRoleArn, props.ecsTaskRoleArn],
              conditions: {
                StringEquals: {
                  "iam:PassedToService": "ecs-tasks.amazonaws.com",
                },
              },
            }),
          ],
        }),
        CloudWatchDashboardPolicy: new PolicyDocument({
          statements: [
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
      entry: path.join(__dirname, "../../../task-runner/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      environment: {
        SCENARIOS_BUCKET: props.scenariosBucket,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        MAIN_STACK_REGION: props.mainStackRegion,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
      },
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(900),
    });

    const taskRunnerLambdaLogGroup = new LogGroup(this, "TaskRunnerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.taskRunner.functionName}`,
      retention: RetentionDays.TEN_YEARS,
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

    // ───────────────────────────────────────────────────────
    // Task Canceler Lambda (cancel-only coordinator)
    // Sets DDB status to CANCELLING, then invokes test-cleanup
    // per region with finalStatus: CANCELLED.
    // ───────────────────────────────────────────────────────
    const taskCancelerRole = new Role(this, "LambdaTaskCancelerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        DynamoDbPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:UpdateItem"],
              resources: [props.scenariosTable.tableArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:PutItem"],
              resources: [props.historyTable.tableArn],
            }),
          ],
        }),
        // SFN permissions (ListExecutions, DescribeExecution, StopExecution)
        // are added in the base stack after the SFN construct is created,
        // scoped to the state machine ARN.
      },
    });
    taskCancelerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    addCfnGuardSuppression(taskCancelerRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.taskCanceler = new NodejsFunction(this, "TaskCancelerNew", {
      description: "Coordinates test cancellation — sets CANCELLING status, invokes test-cleanup per region",
      role: taskCancelerRole,
      entry: path.join(__dirname, "../../../task-canceler/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(300),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        HISTORY_TABLE: props.historyTable.tableName,
        // TEST_CLEANUP_ARN is set after test-cleanup Lambda is created below
      },
    });

    const taskCancelerLambdaLogGroup = new LogGroup(this, "TaskCancellerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.taskCanceler.functionName}`,
      retention: RetentionDays.TEN_YEARS,
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

    // ───────────────────────────────────────────────────────
    // Task Status Checker Lambda
    // ───────────────────────────────────────────────────────
    const taskStatusCheckerRole = new Role(this, "TaskStatusRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        // ecs:ListTasks evaluates aws:ResourceTag against container-instance
        // resources, which don't exist in Fargate. An ecs:cluster condition
        // would work for the main stack cluster, but regional stacks create
        // clusters with names unknown at main stack deploy time, so we
        // cannot scope the condition. Resource:"*" is required.
        // @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonelasticcontainerservice.html
        EcsUnscopedActionsPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:ListTasks"],
              resources: ["*"],
            }),
          ],
        }),
        TaskStatusPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:DescribeTasks"],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:ListBucket"],
              resources: [props.scenariosBucketArn],
            }),
          ],
        }),
      },
    });
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
      description: "Task status checker — running check and S3 completion monitoring",
      role: taskStatusCheckerRole,
      entry: path.join(__dirname, "../../../task-status-checker/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(300),
      environment: {
        SCENARIOS_BUCKET: props.scenariosBucket,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        MAIN_STACK_REGION: props.mainStackRegion,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
      },
    });

    const taskStatusCheckerLambdaLogGroup = new LogGroup(this, "taskStatusCheckerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.taskStatusChecker.functionName}`,
      retention: RetentionDays.TEN_YEARS,
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

    // ───────────────────────────────────────────────────────
    // Test Cleanup Lambda
    // Cleans up test resources for one region and sets the
    // final DDB test status. Invoked by the step function
    // (Phase 3 cleanup, error paths) and by task-canceler.
    // ───────────────────────────────────────────────────────
    const testCleanupRole = new Role(this, "TestCleanupRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        // ecs:ListTasks evaluates aws:ResourceTag against container-instance
        // resources, which don't exist in Fargate. An ecs:cluster condition
        // would work for the main stack cluster, but regional stacks create
        // clusters with names unknown at main stack deploy time, so we
        // cannot scope the condition. Resource:"*" is required.
        // @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonelasticcontainerservice.html
        EcsUnscopedActionsPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:DeregisterTaskDefinition", "ecs:ListTaskDefinitions", "ecs:ListTasks"],
              resources: ["*"],
            }),
          ],
        }),
        EcsTagScopedPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:UpdateService", "ecs:DeleteService", "ecs:DescribeServices", "ecs:DeleteTaskDefinitions"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
          ],
        }),
        MetricFilterPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["logs:DescribeMetricFilters", "logs:DeleteMetricFilter"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
          ],
        }),
        CloudWatchMetricPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "cloudwatch:namespace": "distributed-load-testing",
                },
              },
            }),
          ],
        }),
        DynamoDbPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:UpdateItem"],
              resources: [props.scenariosTable.tableArn, props.historyTable.tableArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:PutItem"],
              resources: [props.historyTable.tableArn],
            }),
          ],
        }),
      },
    });
    testCleanupRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    const testCleanupRoleResource = testCleanupRole.node.defaultChild as CfnResource;
    testCleanupRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "ecs:ListTasks and ecs:DeregisterTaskDefinition do not support resource level permissions",
        },
      ],
    });

    addCfnGuardSuppression(testCleanupRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.testCleanup = new NodejsFunction(this, "TestCleanup", {
      description: "Cleans up ECS resources for one region and sets final DDB status",
      role: testCleanupRole,
      entry: path.join(__dirname, "../../../test-cleanup/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(900),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        HISTORY_TABLE: props.historyTable.tableName,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
      },
    });

    const testCleanupLambdaLogGroup = new LogGroup(this, "TestCleanupLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.testCleanup.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(testCleanupLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.testCleanupLambdaLogGroup = testCleanupLambdaLogGroup;

    const testCleanupResource = this.testCleanup.node.defaultChild as CfnResource;
    testCleanupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    this.testCleanupInvokePolicy = new Policy(this, "TestCleanupInvokePolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["lambda:InvokeFunction"],
          resources: [this.testCleanup.functionArn],
        }),
      ],
    });

    // Wire task-canceler → test-cleanup: env var + invoke permission
    this.taskCanceler.addEnvironment("TEST_CLEANUP_ARN", this.testCleanup.functionArn);
    taskCancelerRole.attachInlinePolicy(this.testCleanupInvokePolicy);

    // ═══════════════════════════════════════════════════════
    // ORCHESTRATION LAMBDAS
    // ═══════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────
    // Stabilization Checker Lambda
    // Polls ECS service health during the step function
    // Wait → Lambda → Choice loop.
    // ───────────────────────────────────────────────────────
    const stabilizationCheckerRole = new Role(this, "StabilizationCheckerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        EcsTagScopedPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:DescribeServices"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
          ],
        }),
      },
    });
    stabilizationCheckerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    addCfnGuardSuppression(stabilizationCheckerRole, "IAM_NO_INLINE_POLICY_CHECK");
    // ecs:DescribeServices supports resource-level ARNs but service ARNs are dynamic/unknown at deploy time;
    // scoped by aws:ResourceTag condition instead.
    // https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonelasticcontainerservice.html
    addCfnGuardSuppression(stabilizationCheckerRole, "IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE");

    this.stabilizationChecker = new NodejsFunction(this, "StabilizationChecker", {
      description: "Checks ECS service stabilization status",
      role: stabilizationCheckerRole,
      entry: path.join(__dirname, "../../../stabilization-checker/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(60),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
      },
    });

    const stabilizationCheckerLambdaLogGroup = new LogGroup(this, "StabilizationCheckerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.stabilizationChecker.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(stabilizationCheckerLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.stabilizationCheckerLambdaLogGroup = stabilizationCheckerLambdaLogGroup;

    const stabilizationCheckerResource = this.stabilizationChecker.node.defaultChild as CfnResource;
    stabilizationCheckerResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    // ───────────────────────────────────────────────────────
    // Start Command Lambda
    // Writes an S3 start marker per region so ECS tasks can
    // detect it via HEAD polling and begin test execution.
    // No VPC attachment needed — uses S3 API (not TCP).
    // ───────────────────────────────────────────────────────
    const startCommandRole = new Role(this, "StartCommandRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        S3StartSignalPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:PutObject"],
              resources: [`${props.scenariosBucketArn}/start-signal/*`],
            }),
          ],
        }),
      },
    });
    startCommandRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    addCfnGuardSuppression(startCommandRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.startCommand = new NodejsFunction(this, "StartCommand", {
      description: "Writes S3 start marker so ECS tasks begin test execution",
      role: startCommandRole,
      entry: path.join(__dirname, "../../../start-command/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(60),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        SCENARIOS_BUCKET: props.scenariosBucket,
        MAIN_STACK_REGION: props.mainStackRegion,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
      },
    });

    const startCommandLambdaLogGroup = new LogGroup(this, "StartCommandLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.startCommand.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(startCommandLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.startCommandLambdaLogGroup = startCommandLambdaLogGroup;

    const startCommandResource = this.startCommand.node.defaultChild as CfnResource;
    startCommandResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    // ───────────────────────────────────────────────────────
    // Regional Sync Lambda
    // Validates all regions are READY after the stabilization
    // Map completes. Emits AllRegionsReady metric via HTTP.
    // No AWS SDK dependencies.
    // ───────────────────────────────────────────────────────
    const regionalSyncRole = new Role(this, "RegionalSyncRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        RegionalSyncPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:UpdateItem"],
              resources: [props.scenariosTable.tableArn],
            }),
          ],
        }),
      },
    });
    regionalSyncRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    addCfnGuardSuppression(regionalSyncRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.regionalSync = new NodejsFunction(this, "RegionalSync", {
      description: "Validates all regions are READY and emits sync metric",
      role: regionalSyncRole,
      entry: path.join(__dirname, "../../../regional-sync/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
      },
    });

    const regionalSyncLambdaLogGroup = new LogGroup(this, "RegionalSyncLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.regionalSync.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(regionalSyncLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.regionalSyncLambdaLogGroup = regionalSyncLambdaLogGroup;

    const regionalSyncResource = this.regionalSync.node.defaultChild as CfnResource;
    regionalSyncResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    // ───────────────────────────────────────────────────────
    // Task Failure Handler Lambda
    // Triggered by EventBridge when ECS tasks stop. Increments
    // a failure counter in DynamoDB and marks the test as
    // failed if the healthy threshold is breached.
    // ───────────────────────────────────────────────────────
    const taskFailureHandlerRole = new Role(this, "TaskFailureHandlerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        TaskFailureHandlerPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
              resources: [props.scenariosTable.tableArn],
            }),
          ],
        }),
        CloudWatchMetricPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "cloudwatch:namespace": "distributed-load-testing",
                },
              },
            }),
          ],
        }),
      },
    });
    taskFailureHandlerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    addCfnGuardSuppression(taskFailureHandlerRole, "IAM_NO_INLINE_POLICY_CHECK");
    // cloudwatch:PutMetricData does not support resource-level permissions; Resource:"*" is required.
    // Scoped by cloudwatch:namespace condition instead.
    // https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncloudwatch.html
    addCfnGuardSuppression(taskFailureHandlerRole, "IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE");

    this.taskFailureHandler = new NodejsFunction(this, "TaskFailureHandler", {
      description: "Handles ECS task failure events and tracks failure threshold",
      role: taskFailureHandlerRole,
      entry: path.join(__dirname, "../../../task-failure-handler/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
      },
    });

    const taskFailureHandlerLambdaLogGroup = new LogGroup(this, "TaskFailureHandlerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.taskFailureHandler.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(taskFailureHandlerLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.taskFailureHandlerLambdaLogGroup = taskFailureHandlerLambdaLogGroup;

    const taskFailureHandlerResource = this.taskFailureHandler.node.defaultChild as CfnResource;
    taskFailureHandlerResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    // EventBridge rule: ECS Task State Change (STOPPED) → Task Failure Handler
    new Rule(this, "ECSTaskStoppedRule", {
      description: "Routes ECS task STOPPED events to the Task Failure Handler for threshold tracking",
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          lastStatus: ["STOPPED"],
        },
      },
      targets: [new LambdaFunctionTarget(this.taskFailureHandler)],
    });

    // ───────────────────────────────────────────────────────
    // Orphan Cleanup Lambda
    // Runs on an hourly schedule. Lists ECS services in the
    // DLT cluster, cross-references active step function
    // executions, and deletes orphaned services.
    // ───────────────────────────────────────────────────────
    const orphanCleanupRole = new Role(this, "OrphanCleanupRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        OrphanCleanupPolicy: new PolicyDocument({
          statements: [
            // ecs:ListServices is a read-only list call scoped to a specific
            // cluster by the Lambda itself. The Lambda discovers clusters
            // dynamically from DDB (main + regional stacks), so we cannot
            // restrict to a single cluster name.
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:ListServices"],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecs:DescribeServices", "ecs:UpdateService", "ecs:DeleteService"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "cloudwatch:namespace": "distributed-load-testing",
                },
              },
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:Scan"],
              resources: [props.scenariosTable.tableArn],
            }),
          ],
        }),
      },
    });
    orphanCleanupRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    const orphanCleanupRoleResource = orphanCleanupRole.node.defaultChild as CfnResource;
    orphanCleanupRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "ecs:ListServices does not support resource level permissions",
        },
      ],
    });

    addCfnGuardSuppression(orphanCleanupRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.orphanCleanup = new NodejsFunction(this, "OrphanCleanup", {
      description: "Hourly scan for orphaned ECS services not associated with active tests",
      role: orphanCleanupRole,
      entry: path.join(__dirname, "../../../orphan-cleanup/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(900),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        // STATE_MACHINE_ARN is set via addEnvironment() in the base stack
        // after SFN construct creation to avoid a circular dependency.
      },
    });

    const orphanCleanupLambdaLogGroup = new LogGroup(this, "OrphanCleanupLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.orphanCleanup.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(orphanCleanupLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.orphanCleanupLambdaLogGroup = orphanCleanupLambdaLogGroup;

    const orphanCleanupResource = this.orphanCleanup.node.defaultChild as CfnResource;
    orphanCleanupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    // EventBridge rule: hourly schedule → Orphan Cleanup
    new Rule(this, "OrphanCleanupScheduleRule", {
      description: "Hourly trigger for orphaned ECS service cleanup",
      schedule: Schedule.rate(Duration.hours(1)),
      targets: [new LambdaFunctionTarget(this.orphanCleanup)],
    });

    // CloudWatch Alarm for orphan cleanup failures
    const orphanCleanupAlarm = new Alarm(this, "OrphanCleanupFailureAlarm", {
      alarmName: `${Aws.STACK_NAME}-OrphanCleanupFailure`,
      alarmDescription:
        "Alerts when orphan ECS service cleanup fails. Manual intervention required to delete orphaned services and prevent ongoing Fargate charges.",
      metric: new Metric({
        namespace: "distributed-load-testing",
        metricName: "OrphanCleanupFailures",
        dimensionsMap: {
          SolutionId: props.solution.id,
        },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.BREACHING,
    });
    addCfnGuardSuppression(orphanCleanupAlarm, "CFN_NO_EXPLICIT_RESOURCE_NAMES");

    // ───────────────────────────────────────────────────────
    // SFN Failure Handler Lambda
    // Layer 2 safety mechanism. Triggered by EventBridge when
    // the task orchestration step function exits with a
    // non-success status. Invokes test-cleanup per region
    // with finalStatus: FAILED.
    // ───────────────────────────────────────────────────────
    const sfnFailureHandlerRole = new Role(this, "SFNFailureHandlerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        SFNFailureHandlerPolicy: new PolicyDocument({
          statements: [
            // states:DescribeExecution is scoped to the specific state machine's
            // executions in the base stack after the SFN construct is created.
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["lambda:InvokeFunction"],
              resources: [this.testCleanup.functionArn],
            }),
          ],
        }),
      },
    });
    sfnFailureHandlerRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    addCfnGuardSuppression(sfnFailureHandlerRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.sfnFailureHandler = new NodejsFunction(this, "SFNFailureHandler", {
      description: "Layer 2 safety: invokes test-cleanup when step function fails",
      role: sfnFailureHandlerRole,
      entry: path.join(__dirname, "../../../sfn-failure-handler/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(120),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        TEST_CLEANUP_ARN: this.testCleanup.functionArn,
      },
    });

    const sfnFailureHandlerLambdaLogGroup = new LogGroup(this, "SFNFailureHandlerLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.sfnFailureHandler.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(sfnFailureHandlerLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.sfnFailureHandlerLambdaLogGroup = sfnFailureHandlerLambdaLogGroup;

    const sfnFailureHandlerResource = this.sfnFailureHandler.node.defaultChild as CfnResource;
    sfnFailureHandlerResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    // NOTE: The EventBridge rule for SFN failure detection is created in the
    // base stack AFTER the step function construct, because it needs the
    // state machine ARN for the event pattern filter.

    // ───────────────────────────────────────────────────────
    // Metrics Emitter Lambda
    // Sends operational metrics (TestStart / TestEnd) to the
    // solutions metrics endpoint. Invoked by the step function
    // via LambdaInvoke — no AWS SDK calls, only outbound HTTPS.
    // ───────────────────────────────────────────────────────
    // Role is created without a logs policy first — the scoped policy is
    // attached below after the log group is created so we can reference
    // the exact log group ARN.
    const metricsEmitterRole = new Role(this, "MetricsEmitterRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });

    addCfnGuardSuppression(metricsEmitterRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.metricsEmitter = new NodejsFunction(this, "MetricsEmitter", {
      description: "Sends operational metrics for test lifecycle events",
      role: metricsEmitterRole,
      entry: path.join(__dirname, "../../lambda/metrics-emitter/index.ts"),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(15),
    });

    const metricsEmitterLambdaLogGroup = new LogGroup(this, "MetricsEmitterLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.metricsEmitter.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(metricsEmitterLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.metricsEmitterLambdaLogGroup = metricsEmitterLambdaLogGroup;

    // Isolated CloudWatch Logs policy scoped to this Lambda's log group.
    // Cannot use the shared cloudWatchLogsPolicy because it creates a
    // transitive CFN dependency cycle: SFN → MetricsEmitter → shared
    // policy → TaskCanceler role → TaskCanceler → SFN (STATE_MACHINE_ARN).
    metricsEmitterRole.attachInlinePolicy(
      new Policy(this, "MetricsEmitterLogsPolicy", {
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
            resources: [metricsEmitterLambdaLogGroup.logGroupArn],
          }),
        ],
      })
    );

    const metricsEmitterResource = this.metricsEmitter.node.defaultChild as CfnResource;
    metricsEmitterResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "MetricsEmitterLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });

    // ───────────────────────────────────────────────────────
    // Test Status Updater Lambda
    // Updates the scenario and history DynamoDB records with
    // the current test status. Guards against overwriting
    // terminal states and conditionally populates history
    // metadata fields on first invocation.
    // ───────────────────────────────────────────────────────
    const testStatusUpdaterRole = new Role(this, "TestStatusUpdaterRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        DynamoDbPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
              resources: [props.scenariosTable.tableArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:UpdateItem"],
              resources: [props.historyTable.tableArn],
            }),
          ],
        }),
      },
    });
    testStatusUpdaterRole.attachInlinePolicy(props.cloudWatchLogsPolicy);

    addCfnGuardSuppression(testStatusUpdaterRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.testStatusUpdater = new NodejsFunction(this, "TestStatusUpdater", {
      description: "Updates scenario and history DynamoDB records with current test status",
      role: testStatusUpdaterRole,
      entry: path.join(__dirname, "../../../test-metadata-updater/src/index.ts"),
      projectRoot: path.join(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: {
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        SCENARIOS_TABLE: props.scenariosTable.tableName,
        HISTORY_TABLE: props.historyTable.tableName,
      },
    });

    const testStatusUpdaterLambdaLogGroup = new LogGroup(this, "TestStatusUpdaterLambdaLogGroup", {
      logGroupName: `/aws/lambda/${this.testStatusUpdater.functionName}`,
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(testStatusUpdaterLambdaLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");
    this.testStatusUpdaterLambdaLogGroup = testStatusUpdaterLambdaLogGroup;

    const testStatusUpdaterResource = this.testStatusUpdater.node.defaultChild as CfnResource;
    testStatusUpdaterResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W58", reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs." },
        { id: "W89", reason: "This Lambda function does not require a VPC" },
        { id: "W92", reason: "Does not run concurrent executions" },
      ],
    });
  }
}
