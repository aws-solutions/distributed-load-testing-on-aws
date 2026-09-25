// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Solution } from "../bin/solution";
import { TaskRunnerStepFunctionConstruct } from "../lib/back-end/step-functions";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const testRole = new Role(stack, "TestRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    inlinePolicies: {
      DenyPolicy: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ["*"],
            resources: ["*"],
          }),
        ],
      }),
    },
  });

  const codeBucket = Bucket.fromBucketName(stack, "SourceCodeBucket", "testbucket");
  const testLambda = new Function(stack, "TestFunction", {
    code: Code.fromBucket(codeBucket, "custom-resource.zip"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_24_X,
    role: testRole,
  });

  const testTable = new Table(stack, "TestTable", {
    partitionKey: { name: "testId", type: AttributeType.STRING },
  });

  const testStateMachine = new TaskRunnerStepFunctionConstruct(stack, "TaskRunnerStepFunction", {
    taskStatusChecker: testLambda,
    taskRunner: testLambda,
    resultsParser: testLambda,
    testCleanup: testLambda,
    stabilizationChecker: testLambda,
    startCommand: testLambda,
    regionalSync: testLambda,
    metricsEmitter: testLambda,
    statusUpdater: testLambda,
    scenariosTable: testTable,
    historyTable: testTable,
    suffix: "abc-def-xyz",
    solution: new Solution("SO0062", "distributed-load-testing-on-aws", "v0.0.0", "test"),
    uuid: "test-uuid-1234",
  });

  const template = createTemplateWithoutS3Key(stack);
  expect(template).toMatchSnapshot();

  const resources = template.toJSON().Resources as Record<
    string,
    { Type: string; Properties: Record<string, unknown> }
  >;
  const stateMachine = Object.values(resources).find(
    (resource) => resource.Type === "AWS::StepFunctions::StateMachine"
  );
  expect(stateMachine).toBeDefined();

  const definitionString = stateMachine?.Properties.DefinitionString as {
    "Fn::Join": [string, unknown[]];
  };
  const definition = JSON.parse(
    definitionString["Fn::Join"][1]
      .map((part) => (typeof part === "string" ? part : "CLOUDFORMATION_TOKEN"))
      .join(definitionString["Fn::Join"][0])
  );
  const states = definition.States;
  const regionalExecutionStates = states["Execution Map"].ItemProcessor.States;

  expect(states["TestStart"].Parameters.Payload).toMatchObject({
    data: { Type: "TestStart", "RunMode.$": "$.runMode" },
  });

  expect(regionalExecutionStates["Is test complete?"]).toMatchObject({
    Choices: [
      {
        And: [
          { Variable: "$.isComplete", BooleanEquals: true },
          { Variable: "$.maxDurationReached", BooleanEquals: true },
        ],
        Next: "Set Final Status: failed",
      },
      {
        Variable: "$.isComplete",
        BooleanEquals: true,
        Next: "Set Final Status: success",
      },
      {
        Variable: "$.timedOut",
        BooleanEquals: true,
        Next: "Prepare Phase 2 Failure Cleanup",
      },
    ],
    Default: "Wait - completion poll",
  });
  expect(regionalExecutionStates["Set Final Status: failed"].Next).toBe("Phase 2 Map End");
  expect(states["Execution Map"].Next).toBe("Check For Failures");
  expect(states["Check For Failures"]).toMatchObject({
    Parameters: {
      "hasFailures.$": "States.ArrayContains($.executionMapResults, 'failed')",
    },
    Next: "Execution failed?",
  });
  expect(states["Execution failed?"]).toMatchObject({
    Choices: [
      {
        Variable: "$.executionResult.hasFailures",
        BooleanEquals: true,
        Next: "Set Error Reason: execution failed",
      },
    ],
    Default: "Set Status: parsing results",
  });
  expect(states["Set Error Reason: execution failed"]).toMatchObject({
    Result: "Test execution failed",
    Next: "Set Status: parsing results",
  });
  expect(states["Set Status: parsing results"].Next).toBe("Parse Results");
  expect(states["Parse Results"]).toMatchObject({
    Next: "Set Status: cleaning up",
    Catch: [
      {
        ErrorEquals: ["States.ALL"],
        ResultPath: "$.error",
        Next: "Set Error Reason: results parsing failed",
      },
    ],
    Parameters: {
      Payload: {
        "nativeRunMode.$": "$.nativeRunMode",
        "executionFailed.$": "$.executionResult.hasFailures",
      },
    },
  });
  expect(states["Set Error Reason: results parsing failed"].Next).toBe("Set Status: cleaning up");
  expect(states["Set Status: cleaning up"].Next).toBe("Test results succeeded?");
  expect(states["Test results succeeded?"].Choices).toContainEqual({
    Variable: "$.executionResult.hasFailures",
    BooleanEquals: true,
    Next: "Error Cleanup Map",
  });
  expect(states["Test results succeeded?"].Choices).toContainEqual({
    Variable: "$.error",
    IsPresent: true,
    Next: "Error Cleanup Map",
  });
  expect(states["Error Cleanup Map"]).toMatchObject({
    Next: "Final Outcome: failed",
    ItemProcessor: {
      StartAt: "Prepare Error Cleanup",
      States: {
        "Prepare Error Cleanup": {
          Parameters: {
            finalStatus: "failed",
            "errorReason.$": "$.errorReason",
          },
          Next: "Invoke Error Cleanup",
        },
      },
    },
  });
  expect(states["Final Outcome: failed"]).toMatchObject({
    Result: "failed",
    Next: "TestEnd",
  });

  // The Task Runner returns a FAILED region result (not a throw) for expected
  // setup failures; the Choice routes it straight to the map end so it flows into
  // Regional Sync carrying its errorMessage, while a successful result continues
  // to the stabilization loop. These states live inside the Stabilization Map's
  // item processor.
  const phase1States = states["Stabilization Map"].ItemProcessor.States;
  expect(phase1States["Task Runner"].Next).toBe("Task Runner failed?");
  // The condition is guarded with IsPresent because a successful TaskRunnerResult
  // carries no `status` field; without the guard the Choice would raise a
  // States.Runtime missing-path error on the happy path.
  expect(phase1States["Task Runner failed?"]).toMatchObject({
    Type: "Choice",
    Choices: [
      {
        And: [
          { Variable: "$.status", IsPresent: true },
          { Variable: "$.status", StringEquals: "FAILED" },
        ],
        Next: "Phase 1 Map End",
      },
    ],
    Default: "Check Stabilization",
  });

  // Load-bearing resilience invariant: $.errorReason is initialized before any
  // failure path can be reached, so the terminal write ("Set Final Status and
  // Endtime") that reads $.errorReason can never fail on a missing JsonPath.
  // Removing/renaming this state would turn a surfacing gap into a pipeline
  // failure, so assert it explicitly rather than relying only on the snapshot.
  expect(states["Init Error Reason"]).toMatchObject({
    Type: "Pass",
    Result: "",
    ResultPath: "$.errorReason",
    Next: "Regional Sync",
  });

  // Regional Sync failure surfaces a specific reason on two distinct paths:
  //  - allReady=false (Choice "otherwise") → propagate the Lambda's composed
  //    per-region reason from $.syncResult.Payload.errorReason.
  //  - Lambda threw (Catch) → fall back to a generic constant (no syncResult).
  expect(states["All regions ready?"].Default).toBe("Set Error Reason: stabilization failed");
  expect(states["Set Error Reason: stabilization failed"]).toMatchObject({
    Type: "Pass",
    InputPath: "$.syncResult.Payload.errorReason",
    ResultPath: "$.errorReason",
    Next: "Cancel All Regions",
  });
  expect(states["Set Error Reason: stabilization failed"].Result).toBeUndefined();
  expect(states["Regional Sync"].Catch).toContainEqual({
    ErrorEquals: ["States.ALL"],
    ResultPath: "$.error",
    Next: "Set Error Reason: regional sync error",
  });
  expect(states["Set Error Reason: regional sync error"]).toMatchObject({
    Type: "Pass",
    Result: "Regional sync failed — at least one region did not stabilize",
    ResultPath: "$.errorReason",
    Next: "Cancel All Regions",
  });

  expect(testStateMachine.taskRunnerStepFunctions).toBeDefined();
});
