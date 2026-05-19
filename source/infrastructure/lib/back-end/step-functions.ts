// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource, Duration } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Policy } from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  Chain,
  Choice,
  Condition,
  DefinitionBody,
  IChainable,
  INextable,
  JsonPath,
  LogLevel,
  Pass,
  Map as SFMap,
  StateMachine,
  Succeed,
  TaskInput,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../../bin/solution";

/**
 * Metric schema version for the operational metric envelope.
 * Must stay in sync with OPERATIONAL_METRIC_EVENT_VERSION in @amzn/dlt-common.
 */
const OPERATIONAL_METRIC_EVENT_VERSION = 1;

export interface TaskRunnerStepFunctionConstructProps {
  readonly taskStatusChecker: NodejsFunction;
  readonly taskRunner: NodejsFunction;
  readonly resultsParser: NodejsFunction;
  readonly testCleanup: NodejsFunction;
  readonly stabilizationChecker: NodejsFunction;
  readonly startCommand: NodejsFunction;
  readonly regionalSync: NodejsFunction;
  readonly metricsEmitter: NodejsFunction;
  readonly statusUpdater: NodejsFunction;
  readonly scenariosTable: Table;
  readonly historyTable: Table;
  readonly suffix: string;
  readonly solution: Solution;
  readonly uuid: string;
}

/**
 * Creates the task orchestration Step Function state machine.
 *
 * The state machine has three phases — see docs/task-orchestration.md Section 3
 * for the full flow diagram and architecture documentation.
 *
 * Phase 1 (Stabilization): Per-region fan-out to create ECS services and poll
 * for health via a Wait → Lambda → Choice loop.
 *
 * Regional Sync: Validates all regions are READY. If any failed, cancels all.
 *
 * Phase 2 (Execution): Per-region fan-out to write S3 start markers and poll
 * S3 completion markers and DynamoDB test status.
 *
 * Post-Execution: Parse Results → Phase 3 (Cleanup Map) → Done.
 *
 * Error handling: All failures route to test-cleanup with finalStatus: failed.
 * Operational metrics (TestStart/TestEnd) are emitted via a lightweight Lambda
 * and never block the test.
 */
export class TaskRunnerStepFunctionConstruct extends Construct {
  public taskRunnerStepFunctions: StateMachine;

  constructor(scope: Construct, id: string, props: TaskRunnerStepFunctionConstructProps) {
    super(scope, id);

    const stepFunctionsLogGroup = this.createLogGroup(props.suffix);
    const done = new Succeed(this, "Done");

    // Build phases bottom-up (CDK requires downstream states to exist first),
    // but each phase is encapsulated in its own helper method for readability.
    const { testEnd } = this.buildOperationalMetricEnd(props, done);
    const { finalOutcomeComplete, finalOutcomeFailed } = this.buildFinalOutcomeStates(testEnd);
    const { cleanupMap, errorCleanupMap } = this.buildCleanupPhase(props, finalOutcomeComplete, finalOutcomeFailed);
    const { setScenarioStatusParsingResults } = this.buildPostExecution(props, cleanupMap, errorCleanupMap);
    const { executionMap } = this.buildExecutionPhase(props, setScenarioStatusParsingResults);
    const { cancelAllMap } = this.buildCancelAllMap(props, finalOutcomeFailed);
    const { regionalSync } = this.buildRegionalSync(props, executionMap, cancelAllMap);
    const { stabilizationMap } = this.buildStabilizationPhase(props, regionalSync);
    const { testStart } = this.buildOperationalMetricStart(props, stabilizationMap);

    // Full chain: TestStart → Stabilization → Sync → Execution → PostExecution → Done
    const definition = Chain.start(testStart);

    this.taskRunnerStepFunctions = new StateMachine(this, "TaskRunnerStepFunctions", {
      definitionBody: DefinitionBody.fromChainable(definition),
      tracingEnabled: true,
      logs: {
        destination: stepFunctionsLogGroup,
        level: LogLevel.ALL,
        includeExecutionData: false,
      },
    });

    this.suppressCfnNagWarnings();
  }

  // ─── Phase 1: Stabilization Map ──────────────────────────
  // Per-region fan-out: Check Running → Task Runner → Stabilization loop.
  // Both READY and FAILED results flow to Regional Sync for aggregation.

  private buildStabilizationPhase(
    props: TaskRunnerStepFunctionConstructProps,
    nextState: IChainable
  ): { stabilizationMap: SFMap } {
    // Error handler for Phase 1 — reshapes event → test-cleanup(failed) → map end
    const preparePhase1FailureCleanup = new Pass(this, "Prepare Phase 1 Failure Cleanup", {
      parameters: {
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testTaskConfig.$": "$.testTaskConfig",
        finalStatus: "failed",
        errorReason: "ECS service creation or stabilization failed",
        skipStatusUpdate: true,
      },
    });
    const phase1ErrorCleanup = new LambdaInvoke(this, "Phase 1 Error Cleanup", {
      lambdaFunction: props.testCleanup,
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
    });
    const phase1MapEnd = new Pass(this, "Phase 1 Map End");
    preparePhase1FailureCleanup.next(phase1ErrorCleanup);
    phase1ErrorCleanup.next(phase1MapEnd);

    // Stabilization polling loop: Wait 10s → Check → Choice
    const checkStabilization = new LambdaInvoke(this, "Check Stabilization", {
      lambdaFunction: props.stabilizationChecker,
      inputPath: "$",
      outputPath: "$.Payload",
    });

    const waitStabilization = new Wait(this, "Wait 10s - stabilization", {
      time: WaitTime.duration(Duration.seconds(10)),
    });

    const stabilizationChoice = new Choice(this, "Service stable?");
    stabilizationChoice.when(Condition.stringEquals("$.status", "READY"), phase1MapEnd);
    stabilizationChoice.when(Condition.stringEquals("$.status", "FAILED"), phase1MapEnd);
    stabilizationChoice.otherwise(waitStabilization);

    waitStabilization.next(checkStabilization);
    checkStabilization.next(stabilizationChoice);
    checkStabilization.addCatch(preparePhase1FailureCleanup, { resultPath: "$.error" });

    // Task Runner — creates ECS service + task definition + dashboard
    const runTaskRunner = new LambdaInvoke(this, "Task Runner", {
      lambdaFunction: props.taskRunner,
      inputPath: "$",
      outputPath: "$.Payload",
    });
    runTaskRunner.next(checkStabilization);
    runTaskRunner.addCatch(preparePhase1FailureCleanup, { resultPath: "$.error" });

    // Pre-test validation: is the test already running?
    const checkRunningTests = new LambdaInvoke(this, "Check Running Tests", {
      lambdaFunction: props.taskStatusChecker,
      inputPath: "$",
      outputPath: "$.Payload",
    });

    const testAlreadyRunningEnd = new Pass(this, "Test Already Running End");
    testAlreadyRunningEnd.next(phase1MapEnd);

    const runningTestsChoice = new Choice(this, "Test already running?");
    runningTestsChoice.when(Condition.booleanEquals("$.isRunning", true), testAlreadyRunningEnd);
    runningTestsChoice.otherwise(runTaskRunner);

    checkRunningTests.next(runningTestsChoice);
    checkRunningTests.addCatch(preparePhase1FailureCleanup, { resultPath: "$.error" });

    // Phase 1 Map — fans out per region from testTaskConfig[]
    const stabilizationMap = new SFMap(this, "Stabilization Map", {
      inputPath: "$",
      itemsPath: "$.testTaskConfig",
      resultPath: "$.stabilizationResults",
      itemSelector: {
        "testTaskConfig.$": "$$.Map.Item.Value",
        "testId.$": "$.testId",
        "testType.$": "$.testType",
        "fileType.$": "$.fileType",
        "showLive.$": "$.showLive",
        "testDuration.$": "$.testDuration",
        "prefix.$": "$.prefix",
        "testRunId.$": "$.testRunId",
        "hubTaskDefinition.$": "$.hubTaskDefinition",
      },
      maxConcurrency: 0,
    });
    stabilizationMap.itemProcessor(checkRunningTests);
    stabilizationMap.next(nextState);

    return { stabilizationMap };
  }

  // ─── Regional Sync ───────────────────────────────────────
  // Validates all regions are READY. Routes to execution or cancel.

  private buildRegionalSync(
    props: TaskRunnerStepFunctionConstructProps,
    executionMap: IChainable,
    cancelAllMap: IChainable
  ): { regionalSync: LambdaInvoke } {
    const regionalSync = new LambdaInvoke(this, "Regional Sync", {
      lambdaFunction: props.regionalSync,
      payload: TaskInput.fromObject({
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testType.$": "$.testType",
        "regions.$": "$.stabilizationResults",
      }),
      resultPath: "$.syncResult",
    });

    // Set DDB status to "running" before the Execution Map.
    // The Task Failure Handler checks `status === "running"` before
    // evaluating the healthy threshold.
    const setStatusRunning = new LambdaInvoke(this, "Set Status: running", {
      lambdaFunction: props.statusUpdater,
      payload: TaskInput.fromObject({
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        status: "running",
      }),
      resultPath: JsonPath.DISCARD,
    });

    setStatusRunning.next(executionMap);

    const syncChoice = new Choice(this, "All regions ready?");
    syncChoice.when(Condition.booleanEquals("$.syncResult.Payload.allReady", true), setStatusRunning);
    syncChoice.otherwise(cancelAllMap);

    regionalSync.next(syncChoice);
    regionalSync.addCatch(cancelAllMap, { resultPath: "$.error" });

    return { regionalSync };
  }

  // ─── Cancel All Regions ──────────────────────────────────
  // When regional sync detects failures, invokes test-cleanup(failed)
  // per region.

  private buildCancelAllMap(
    props: TaskRunnerStepFunctionConstructProps,
    finalOutcomeFailed: IChainable
  ): { cancelAllMap: SFMap } {
    const prepareCancelCleanup = new Pass(this, "Prepare Cancel Cleanup", {
      parameters: {
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testTaskConfig.$": "$.testTaskConfig",
        finalStatus: "failed",
        errorReason: "Regional sync failed \u2014 at least one region did not stabilize",
        skipStatusUpdate: true,
      },
    });

    const cancelRegion = new LambdaInvoke(this, "Cancel Region", {
      lambdaFunction: props.testCleanup,
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
    });
    prepareCancelCleanup.next(cancelRegion);

    const cancelAllMap = new SFMap(this, "Cancel All Regions", {
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
      itemsPath: "$.stabilizationResults",
      maxConcurrency: 0,
    });
    cancelAllMap.itemProcessor(prepareCancelCleanup);
    cancelAllMap.next(finalOutcomeFailed);

    return { cancelAllMap };
  }

  // ─── Phase 2: Execution Map ──────────────────────────────
  // Per-region: Send START → Poll completion (DDB status + S3 markers).
  // Happy path ends cleanly; Phase 3 handles resource cleanup.

  private buildExecutionPhase(
    props: TaskRunnerStepFunctionConstructProps,
    nextState: IChainable & INextable
  ): { executionMap: SFMap } {
    const phase2MapEnd = new Pass(this, "Phase 2 Map End", {
      outputPath: "$.finalStatus",
    });

    // Error path: test-cleanup(failed) → map end
    const preparePhase2FailureCleanup = new Pass(this, "Prepare Phase 2 Failure Cleanup", {
      parameters: {
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testTaskConfig.$": "$.testTaskConfig",
        finalStatus: "failed",
        "errorReason.$": "$.errorReason",
        skipStatusUpdate: true,
      },
    });
    const phase2ErrorCleanup = new LambdaInvoke(this, "Phase 2 Error Cleanup", {
      lambdaFunction: props.testCleanup,
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
    });
    preparePhase2FailureCleanup.next(phase2ErrorCleanup);
    phase2ErrorCleanup.next(phase2MapEnd);

    // Completion monitoring loop: Check → Choice → Wait 15s → Check ...
    const checkCompletion = new LambdaInvoke(this, "Check Completion", {
      lambdaFunction: props.taskStatusChecker,
      inputPath: "$",
      outputPath: "$.Payload",
    });

    const waitCompletionPoll = new Wait(this, "Wait 15s - completion", {
      time: WaitTime.duration(Duration.seconds(15)),
    });
    waitCompletionPoll.next(checkCompletion);

    const setFinalSuccessStatus = new Pass(this, "Set Final Status: success", {
      parameters: {
        finalStatus: "success",
      },
    });
    setFinalSuccessStatus.next(phase2MapEnd);

    const completionChoice = new Choice(this, "Is test complete?");
    completionChoice.when(Condition.booleanEquals("$.isComplete", true), setFinalSuccessStatus);
    completionChoice.when(Condition.booleanEquals("$.timedOut", true), preparePhase2FailureCleanup);
    completionChoice.otherwise(waitCompletionPoll);

    checkCompletion.next(completionChoice);

    const prepareCompletionMonitorFailure = new Pass(this, "Prepare Completion Monitor Failure", {
      parameters: {
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testTaskConfig.$": "$.testTaskConfig",
        finalStatus: "failed",
        errorReason: "Completion monitoring failed",
        skipStatusUpdate: true,
      },
    });
    prepareCompletionMonitorFailure.next(phase2ErrorCleanup);
    checkCompletion.addCatch(prepareCompletionMonitorFailure, { resultPath: "$.error" });

    // Send START command to all tasks in the region
    const sendStartCommand = new LambdaInvoke(this, "Send START Command", {
      lambdaFunction: props.startCommand,
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
    });
    sendStartCommand.next(checkCompletion);

    const prepareStartCommandFailure = new Pass(this, "Prepare Start Command Failure", {
      parameters: {
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testTaskConfig.$": "$.testTaskConfig",
        finalStatus: "failed",
        errorReason: "Failed to send start command",
        skipStatusUpdate: true,
      },
    });
    prepareStartCommandFailure.next(phase2ErrorCleanup);
    sendStartCommand.addCatch(prepareStartCommandFailure, { resultPath: "$.error" });

    // Execution Map — fans out per region from stabilization results
    const executionMap = new SFMap(this, "Execution Map", {
      inputPath: "$",
      resultPath: "$.executionMapResults",
      itemsPath: "$.stabilizationResults",
      maxConcurrency: 0,
    });
    executionMap.itemProcessor(sendStartCommand);

    const checkForFailures = new Pass(this, "Check For Failures", {
      parameters: {
        "hasFailures.$": "States.ArrayContains($.executionMapResults, 'failed')",
      },
      resultPath: "$.executionResult",
    });
    executionMap.next(checkForFailures);
    checkForFailures.next(nextState);

    return { executionMap };
  }

  // ─── Post-Execution: Parse Results → Cleanup ─────────────
  // DDB status transitions → results parsing → Phase 3 cleanup.
  // If parsing fails, routes to error cleanup instead of happy-path cleanup.

  private buildPostExecution(
    props: TaskRunnerStepFunctionConstructProps,
    cleanupMap: IChainable,
    errorCleanupMap: IChainable
  ): { setScenarioStatusParsingResults: LambdaInvoke } {
    // Choice: did Test Results succeed or fail?
    const cleanupRouteChoice = new Choice(this, "Test results succeeded?");
    cleanupRouteChoice.when(Condition.booleanEquals("$.executionResult.hasFailures", true), errorCleanupMap);
    cleanupRouteChoice.when(Condition.isPresent("$.error"), errorCleanupMap);
    cleanupRouteChoice.otherwise(cleanupMap);

    // Set Status: cleaning up
    const setScenarioStatusCleaningUp = new LambdaInvoke(this, "Set Status: cleaning up", {
      lambdaFunction: props.statusUpdater,
      payload: TaskInput.fromObject({
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        status: "cleaning up",
      }),
      resultPath: JsonPath.DISCARD,
    });

    setScenarioStatusCleaningUp.next(cleanupRouteChoice);

    // Parse Results Lambda
    const parseResult = new LambdaInvoke(this, "Parse Results", {
      lambdaFunction: props.resultsParser,
      payload: TaskInput.fromObject({
        "testTaskConfig.$": "$.testTaskConfig",
        "testId.$": "$.testId",
        "testType.$": "$.testType",
        "fileType.$": "$.fileType",
        "showLive.$": "$.showLive",
        "testDuration.$": "$.testDuration",
        "prefix.$": "$.prefix",
        "testRunId.$": "$.testRunId",
        "executionStart.$": "$$.Execution.StartTime",
      }),
      resultPath: "$.parseResult",
    });
    parseResult.next(setScenarioStatusCleaningUp);
    parseResult.addCatch(setScenarioStatusCleaningUp, { resultPath: "$.error" });

    // Set Status: parsing results
    const setScenarioStatusParsingResults = new LambdaInvoke(this, "Set Status: parsing results", {
      lambdaFunction: props.statusUpdater,
      payload: TaskInput.fromObject({
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        status: "parsing results",
      }),
      resultPath: JsonPath.DISCARD,
    });

    setScenarioStatusParsingResults.next(parseResult);

    return { setScenarioStatusParsingResults };
  }

  // ─── Phase 3: Cleanup Maps ───────────────────────────────
  // Per-region test-cleanup invocations. Two variants:
  //   - cleanupMap: finalStatus "complete" (happy path)
  //   - errorCleanupMap: finalStatus "failed" (Parse Results error)

  private buildCleanupPhase(
    props: TaskRunnerStepFunctionConstructProps,
    finalOutcomeComplete: IChainable,
    finalOutcomeFailed: IChainable
  ): { cleanupMap: SFMap; errorCleanupMap: SFMap } {
    // Happy-path cleanup
    const prepareCompleteCleanup = new Pass(this, "Prepare Complete Cleanup", {
      parameters: {
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testTaskConfig.$": "$.testTaskConfig",
        finalStatus: "complete",
        skipStatusUpdate: true,
      },
    });
    const invokeCleanup = new LambdaInvoke(this, "Invoke Test Cleanup", {
      lambdaFunction: props.testCleanup,
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
    });
    prepareCompleteCleanup.next(invokeCleanup);

    const cleanupMap = new SFMap(this, "Cleanup Map", {
      inputPath: "$",
      itemsPath: "$.stabilizationResults",
      resultPath: JsonPath.DISCARD,
      maxConcurrency: 0,
    });
    cleanupMap.itemProcessor(prepareCompleteCleanup);
    cleanupMap.next(finalOutcomeComplete);

    // Error cleanup (when Parse Results fails)
    const prepareErrorCleanup = new Pass(this, "Prepare Error Cleanup", {
      parameters: {
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "testTaskConfig.$": "$.testTaskConfig",
        finalStatus: "failed",
        errorReason: "Results parsing failed",
        skipStatusUpdate: true,
      },
    });
    const invokeErrorCleanup = new LambdaInvoke(this, "Invoke Error Cleanup", {
      lambdaFunction: props.testCleanup,
      inputPath: "$",
      resultPath: JsonPath.DISCARD,
    });
    prepareErrorCleanup.next(invokeErrorCleanup);

    const errorCleanupMap = new SFMap(this, "Error Cleanup Map", {
      inputPath: "$",
      itemsPath: "$.stabilizationResults",
      resultPath: JsonPath.DISCARD,
      maxConcurrency: 0,
    });
    errorCleanupMap.itemProcessor(prepareErrorCleanup);
    errorCleanupMap.next(finalOutcomeFailed);

    return { cleanupMap, errorCleanupMap };
  }

  // ─── Final Outcome Pass States ───────────────────────────
  // Set $.finalOutcome before TestEnd so it knows the result.

  private buildFinalOutcomeStates(testEnd: IChainable): {
    finalOutcomeComplete: Pass;
    finalOutcomeFailed: Pass;
  } {
    const finalOutcomeComplete = new Pass(this, "Final Outcome: complete", {
      result: { value: "complete" },
      resultPath: "$.finalOutcome",
    });
    finalOutcomeComplete.next(testEnd);

    const finalOutcomeFailed = new Pass(this, "Final Outcome: failed", {
      result: { value: "failed" },
      resultPath: "$.finalOutcome",
    });
    finalOutcomeFailed.next(testEnd);

    return { finalOutcomeComplete, finalOutcomeFailed };
  }

  // ─── Operational Metrics ─────────────────────────────────
  // TestStart emits before stabilization, TestEnd emits after cleanup.
  // Both swallow errors to never block the test.

  private buildOperationalMetricEnd(
    props: TaskRunnerStepFunctionConstructProps,
    done: Succeed
  ): { testEnd: LambdaInvoke } {
    // Write terminal status + endTime as the very last step.
    // This is the single point where the SFN sets terminal DDB status,
    // ensuring no premature terminal state is visible to polling consumers.
    const setScenarioStatusParsingResults = new LambdaInvoke(this, "Set Final Status and Endtime", {
      lambdaFunction: props.statusUpdater,
      payload: TaskInput.fromObject({
        "testId.$": "$.testId",
        "testRunId.$": "$.testRunId",
        "status.$": "$.finalOutcome",
        "endTime.$": "$$.State.EnteredTime",
      }),
      resultPath: JsonPath.DISCARD,
    });

    setScenarioStatusParsingResults.next(done);

    // ── TestEnd: operational metric ────────────────────────
    const testEnd = new LambdaInvoke(this, "TestEnd", {
      lambdaFunction: props.metricsEmitter,
      payload: TaskInput.fromObject({
        solutionId: props.solution.id,
        uuid: props.uuid,
        version: props.solution.version,
        metricUrl: SOLUTIONS_METRICS_ENDPOINT,
        accountId: Aws.ACCOUNT_ID,
        metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
        data: {
          Type: "TestEnd",
          "TestId.$": "$.testId",
          "TestType.$": "$.testType",
          "FinalStatus.$": "$.finalOutcome",
        },
      }),
      resultPath: JsonPath.DISCARD,
    });
    testEnd.addCatch(setScenarioStatusParsingResults, { resultPath: JsonPath.DISCARD });
    testEnd.next(setScenarioStatusParsingResults);

    return { testEnd };
  }

  private buildOperationalMetricStart(
    props: TaskRunnerStepFunctionConstructProps,
    stabilizationMap: IChainable
  ): { testStart: LambdaInvoke } {
    const testStart = new LambdaInvoke(this, "TestStart", {
      lambdaFunction: props.metricsEmitter,
      payload: TaskInput.fromObject({
        solutionId: props.solution.id,
        uuid: props.uuid,
        version: props.solution.version,
        metricUrl: SOLUTIONS_METRICS_ENDPOINT,
        accountId: Aws.ACCOUNT_ID,
        metricSchemaVersion: OPERATIONAL_METRIC_EVENT_VERSION,
        data: {
          Type: "TestStart",
          "TestId.$": "$.testId",
          "TestType.$": "$.testType",
          "FileType.$": "$.fileType",
          "TestDuration.$": "$.testDuration",
          "RegionCount.$": "States.ArrayLength($.testTaskConfig)",
        },
      }),
      resultPath: JsonPath.DISCARD,
    });
    testStart.addCatch(stabilizationMap, { resultPath: JsonPath.DISCARD });
    testStart.next(stabilizationMap);

    return { testStart };
  }

  // ─── Infrastructure ──────────────────────────────────────

  private createLogGroup(suffix: string): LogGroup {
    const stepFunctionsLogGroup = new LogGroup(this, "StepFunctionsLogGroup", {
      retention: RetentionDays.TEN_YEARS,
      logGroupName: `/aws/vendedlogs/states/StepFunctionsLogGroup${Aws.STACK_NAME}${suffix}`,
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
    return stepFunctionsLogGroup;
  }

  private suppressCfnNagWarnings(): void {
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
