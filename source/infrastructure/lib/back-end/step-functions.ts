// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Chain,
  Choice,
  Condition,
  Fail,
  Pass,
  LogLevel,
  Map as SFMap,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
  JsonPath,
  DefinitionBody,
  TaskInput,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Aws, CfnResource, Duration } from "aws-cdk-lib";
import { Policy } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

export interface TaskRunnerStepFunctionConstructProps {
  // State machine Lambda functions
  readonly taskStatusChecker: NodejsFunction;
  readonly taskRunner: NodejsFunction;
  readonly resultsParser: NodejsFunction;
  readonly taskCanceler: NodejsFunction;
  readonly suffix: string;
}

/**
 * Creates the Step function state machine to control the Fargate tasks
 */
export class TaskRunnerStepFunctionConstruct extends Construct {
  public taskRunnerStepFunctions: StateMachine;

  constructor(scope: Construct, id: string, props: TaskRunnerStepFunctionConstructProps) {
    super(scope, id);

    const stepFunctionsLogGroup = new LogGroup(this, "StepFunctionsLogGroup", {
      retention: RetentionDays.ONE_YEAR,
      logGroupName: `/aws/vendedlogs/states/StepFunctionsLogGroup${Aws.STACK_NAME}${props.suffix}`,
    });
    const stepFunctionsLogGroupResource = stepFunctionsLogGroup.node.defaultChild as CfnResource;
    stepFunctionsLogGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W84",
          reason: "KMS encryption unnecessary for log group",
        },
      ],
    });

    const done = new Succeed(this, "Done");
    const mapEnd = new Pass(this, "Map End");
    const parseResult = new LambdaInvoke(this, "Parse result", {
      lambdaFunction: props.resultsParser,
      payload: TaskInput.fromObject({
        "testTaskConfig.$": "$.testTaskConfig",
        "testId.$": "$.testId",
        "testType.$": "$.testType",
        "fileType.$": "$.fileType",
        "showLive.$": "$.showLive",
        "testDuration.$": "$.testDuration",
        "prefix.$": "$.prefix",
        "executionStart.$": "$$.Execution.StartTime",
      }),
    });
    parseResult.next(done);

    const checkWorkerStatus = new LambdaInvoke(this, "Check worker status", {
      lambdaFunction: props.taskStatusChecker,
      inputPath: "$",
      outputPath: "$.Payload",
    });

    const checkTaskStatus = new LambdaInvoke(this, "Check task status", {
      lambdaFunction: props.taskStatusChecker,
      inputPath: "$",
      outputPath: "$.Payload",
    });

    const waitTask = new Wait(this, "Wait 1 minute - task status", {
      comment: "Wait 1 minute to check task status again",
      time: WaitTime.duration(Duration.seconds(60)),
    });
    waitTask.next(checkTaskStatus);

    const waitTestDuration = new Wait(this, "Wait specified test duration", {
      time: WaitTime.secondsPath("$.testDuration"),
    });
    waitTestDuration.next(checkTaskStatus);

    const allTasksDone = new Choice(this, "Are all tasks done?");
    allTasksDone.when(Condition.booleanEquals("$.isRunning", false), mapEnd);
    allTasksDone.otherwise(waitTask);

    checkTaskStatus.next(allTasksDone);

    const cancelTest = new LambdaInvoke(this, "Cancel Test", {
      lambdaFunction: props.taskCanceler,
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
    });
    cancelTest.next(mapEnd);

    const waitWorker = new Wait(this, "Wait 1 minute - worker status", {
      comment: "Wait 1 minute to check task status again",
      time: WaitTime.duration(Duration.seconds(60)),
    });
    waitWorker.next(checkWorkerStatus);

    const regionConfigsForTest = new SFMap(this, "Regions for testing", {
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
      itemsPath: "$.testTaskConfig",
      itemSelector: {
        "testTaskConfig.$": "$$.Map.Item.Value",
        "testId.$": "$.testId",
        "testType.$": "$.testType",
        "fileType.$": "$.fileType",
        "showLive.$": "$.showLive",
        "testDuration.$": "$.testDuration",
        "prefix.$": "$.prefix",
      },
    });

    const runWorkers = new LambdaInvoke(this, "Run workers", {
      lambdaFunction: props.taskRunner,
      inputPath: "$",
      outputPath: "$.Payload",
    });

    const requiresLeader = new Choice(this, "Requires leader?");
    requiresLeader.when(Condition.booleanEquals("$.isRunning", false), cancelTest);
    requiresLeader.when(Condition.isNotPresent("$.taskIds"), waitTestDuration);
    requiresLeader.otherwise(waitWorker);

    runWorkers.next(requiresLeader);

    const runLeaderTask = new LambdaInvoke(this, "Run leader task", {
      lambdaFunction: props.taskRunner,
      inputPath: "$",
      outputPath: "$.Payload",
    });
    runLeaderTask.addCatch(cancelTest, { resultPath: "$.error" });

    runLeaderTask.next(waitTestDuration);

    const allWorkersRunning = new Choice(this, "Are all workers running?");
    allWorkersRunning.when(Condition.booleanEquals("$.isRunning", false), cancelTest);
    allWorkersRunning.when(Condition.numberEqualsJsonPath("$.numTasksRunning", "$.numTasksTotal"), runLeaderTask);
    allWorkersRunning.otherwise(waitWorker);

    checkWorkerStatus.next(allWorkersRunning);

    const testIsStillRunning = new Fail(this, "Test is still running", {
      cause: "The same test is already running.",
      error: "TestAlreadyRunning",
    });

    const noRunningTests = new Choice(this, "No running tests");
    noRunningTests.when(Condition.booleanEquals("$.isRunning", false), runWorkers);
    noRunningTests.otherwise(testIsStillRunning);

    const checkRunningTests = new LambdaInvoke(this, "Check running tests", {
      lambdaFunction: props.taskStatusChecker,
      inputPath: "$",
      outputPath: "$.Payload",
    });
    checkRunningTests.next(noRunningTests);

    const definition = Chain.start(regionConfigsForTest.itemProcessor(checkRunningTests)).next(parseResult);

    this.taskRunnerStepFunctions = new StateMachine(this, "TaskRunnerStepFunctions", {
      definitionBody: DefinitionBody.fromChainable(definition),
      logs: {
        destination: stepFunctionsLogGroup,
        level: LogLevel.ALL,
        includeExecutionData: false,
      },
    });
    const stepFunctionsRoleResource = this.taskRunnerStepFunctions.role.node.defaultChild as CfnResource;
    stepFunctionsRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "CloudWatch logs actions do not support resource level permissions",
        },
        {
          id: "W12",
          reason: "CloudWatch logs actions do not support resource level permissions",
        },
      ],
    });
    const stepFunctionPolicy = this.taskRunnerStepFunctions.role.node.findChild("DefaultPolicy") as Policy;
    const policyResource = stepFunctionPolicy.node.defaultChild as CfnResource;
    policyResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W12",
          reason: "CloudWatch logs actions do not support resource level permissions",
        },
        {
          id: "W76",
          reason: "The IAM policy is written for least-privilege access.",
        },
      ],
    });
  }
}
