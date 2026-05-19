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

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(testStateMachine.taskRunnerStepFunctions).toBeDefined();
});
