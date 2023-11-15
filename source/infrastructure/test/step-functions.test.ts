// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { TaskRunnerStepFunctionConstruct } from "../lib/back-end/step-functions";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

test("DLT API Test", () => {
  const app = new App();
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

  const testLambda = new LambdaFunction(stack, "TestFunction", {
    code: Code.fromBucket(Bucket.fromBucketName(stack, "SourceCodeBucket", "testbucket"), "custom-resource.zip"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_18_X,
    role: testRole,
  });

  const testStateMachine = new TaskRunnerStepFunctionConstruct(stack, "TaskRunnerStepFunction", {
    taskStatusChecker: testLambda,
    taskRunner: testLambda,
    resultsParser: testLambda,
    taskCanceler: testLambda,
    solutionId: "testId",
    suffix: "abc-def-xyz",
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  expect(testStateMachine.taskRunnerStepFunctions).toBeDefined();
});
