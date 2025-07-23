// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { TaskRunnerStepFunctionConstruct } from "../lib/back-end/step-functions";
import { Code, Runtime, Function } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

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

  const codeBucket = Bucket.fromBucketName(stack, "SourceCodeBucket", "testbucket");
  const testLambda = new Function(stack, "TestFunction", {
    code: Code.fromBucket(codeBucket, "custom-resource.zip"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_20_X,
    role: testRole,
  });

  const testStateMachine = new TaskRunnerStepFunctionConstruct(stack, "TaskRunnerStepFunction", {
    taskStatusChecker: testLambda,
    taskRunner: testLambda,
    resultsParser: testLambda,
    taskCanceler: testLambda,
    suffix: "abc-def-xyz",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(testStateMachine.taskRunnerStepFunctions).toBeDefined();
});
