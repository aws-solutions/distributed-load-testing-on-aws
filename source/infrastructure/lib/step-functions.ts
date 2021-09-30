// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Chain, Choice, Condition, DISCARD, Fail, LogLevel, StateMachine, Succeed, Wait, WaitTime } from "@aws-cdk/aws-stepfunctions";
import { LambdaInvoke } from "@aws-cdk/aws-stepfunctions-tasks";
import { CfnResource, Construct, Duration, Tags } from "@aws-cdk/core";
import { Policy } from "@aws-cdk/aws-iam";
import { LogGroup, RetentionDays } from "@aws-cdk/aws-logs";
import { IFunction } from "@aws-cdk/aws-lambda";


/**
 * CustomResourcesConstruct props
 * @interface TaskRunnerStepFunctionConstructProps
 */
export interface TaskRunnerStepFunctionConstructProps {
    // State machine Lambda functions
    readonly taskStatusChecker: IFunction;
    readonly taskRunner: IFunction;
    readonly resultsParser: IFunction;
    readonly taskCanceler: IFunction;
    // Solution ID
    readonly solutionId: string;
}

/**
 * @class
 */
export class TaskRunnerStepFunctionConstruct extends Construct {
    public taskRunnerStepFunctions: StateMachine;

    constructor(scope: Construct, id: string, props: TaskRunnerStepFunctionConstructProps) {
        super(scope, id);

        const stepFunctionsLogGroup = new LogGroup(this, 'StepFunctionsLogGroup', {
            retention: RetentionDays.ONE_YEAR
        });
        const stepFunctionsLogGroupResource = stepFunctionsLogGroup.node.defaultChild as CfnResource;
        stepFunctionsLogGroupResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W84',
                reason: 'KMS encryption unnecessary for log group'
            }]
        });

        const done = new Succeed(this, 'Done');

        const parseResult = new LambdaInvoke(this, 'Parse result', {
            lambdaFunction: props.resultsParser
        });
        parseResult.next(done);

        const checkWorkerStatus = new LambdaInvoke(this, 'Check worker status', {
            lambdaFunction: props.taskStatusChecker,
            inputPath: '$',
            outputPath: '$.Payload'
        });

        const checkTaskStatus = new LambdaInvoke(this, 'Check task status', {
            lambdaFunction: props.taskStatusChecker,
            inputPath: '$',
            outputPath: '$.Payload'
        });

        const waitTask = new Wait(this, 'Wait 1 minute - task status', {
            comment: 'Wait 1 minute to check task status again',
            time: WaitTime.duration(Duration.seconds(60))
        });
        waitTask.next(checkTaskStatus);

        const allTasksDone = new Choice(this, 'Are all tasks done?');
        allTasksDone.when(Condition.booleanEquals('$.isRunning', false), parseResult);
        allTasksDone.otherwise(waitTask);

        checkTaskStatus.next(allTasksDone);

        const cancelTest = new LambdaInvoke(this, 'Cancel Test', {
            lambdaFunction: props.taskCanceler,
            inputPath: '$',
            outputPath: '$.Payload',
            resultPath: DISCARD
        });
        cancelTest.next(parseResult);

        const waitWorker = new Wait(this, 'Wait 1 minute - worker status', {
            comment: 'Wait 1 minute to check task status again',
            time: WaitTime.duration(Duration.seconds(60))
        });
        waitWorker.next(checkWorkerStatus);

        const runWorkers = new LambdaInvoke(this, 'Run workers', {
            lambdaFunction: props.taskRunner,
            inputPath: '$',
            outputPath: '$.Payload'
        });

        const allWorkersLaunched = new Choice(this, 'Are all workers launched?');
        allWorkersLaunched.when(Condition.booleanEquals('$.isRunning', false), cancelTest);
        allWorkersLaunched.when(Condition.numberEquals('$.taskRunner.runTaskCount', 1), waitWorker);
        allWorkersLaunched.when(Condition.numberEquals('$.taskRunner.runTaskCount', 0), waitTask);
        allWorkersLaunched.otherwise(runWorkers);

        runWorkers.next(allWorkersLaunched);

        const runLeaderTask = new LambdaInvoke(this, 'Run leader task', {
            lambdaFunction: props.taskRunner,
            inputPath: '$',
            outputPath: '$.Payload'
        });
        runLeaderTask.next(waitTask);

        const allWorkersRunning = new Choice(this, 'Are all workers running?');
        allWorkersRunning.when(Condition.numberEqualsJsonPath('$.numTasksRunning', '$.scenario.taskCount'), runLeaderTask);
        allWorkersRunning.when(Condition.booleanEquals('$.isRunning', false), parseResult);
        allWorkersRunning.otherwise(waitWorker);

        checkWorkerStatus.next(allWorkersRunning);

        const testIsStillRunning = new Fail(this, 'Test is still running', {
            cause: 'The same test is already running.',
            error: 'TestAlreadyRunning'
        });

        const noRunningTests = new Choice(this, 'No running tests');
        noRunningTests.when(Condition.booleanEquals('$.isRunning', false), runWorkers);
        noRunningTests.otherwise(testIsStillRunning);

        const checkRunningTests = new LambdaInvoke(this, 'Check running tests', {
            lambdaFunction: props.taskStatusChecker,
            inputPath: '$',
            outputPath: '$.Payload'
        });
        checkRunningTests.next(noRunningTests);

        const definition = Chain
            .start(checkRunningTests)

        this.taskRunnerStepFunctions = new StateMachine(this, 'TaskRunnerStepFunctions', {
            definition,
            logs: {
                destination: stepFunctionsLogGroup,
                level: LogLevel.ALL,
                includeExecutionData: false
            }
        });
        const stepFunctionsRoleResource = this.taskRunnerStepFunctions.role.node.defaultChild as CfnResource;
        stepFunctionsRoleResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W11',
                reason: 'CloudWatch logs actions do not support resource level permissions'
            }, {
                id: 'W12',
                reason: 'CloudWatch logs actions do not support resource level permissions'
            }]
        });
        const stepFunctionPolicy = this.taskRunnerStepFunctions.role.node.findChild('DefaultPolicy') as Policy;
        const policyResource = stepFunctionPolicy.node.defaultChild as CfnResource;
        policyResource.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W12',
                reason: 'CloudWatch logs actions do not support resource level permissions'
            }]
        });
        Tags.of(this.taskRunnerStepFunctions).add('SolutionId', props.solutionId);
    }
}