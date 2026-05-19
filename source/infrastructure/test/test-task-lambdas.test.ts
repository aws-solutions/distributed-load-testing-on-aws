// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../bin/solution";
import { TestRunnerLambdasConstruct } from "../lib/back-end/test-task-lambdas";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT Task Lambda Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const testDBPolicy = new Policy(stack, "TestDynamoDBPolicy", {
    statements: [
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ["dynamodb:*"],
        resources: ["*"],
      }),
    ],
  });

  const testS3Policy = new Policy(stack, "TestS3Policy", {
    statements: [
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ["s3:*"],
        resources: ["*"],
      }),
    ],
  });

  const testPolicy = new Policy(stack, "TestPolicy", {
    statements: [
      new PolicyStatement({
        resources: ["*"],
        actions: ["cloudwatch:Get*"],
      }),
    ],
  });

  const testTable = new Table(stack, "TestTable", {
    partitionKey: {
      name: "id",
      type: AttributeType.STRING,
    },
  });
  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  const testFunctions = new TestRunnerLambdasConstruct(stack, "TaskRunnerLambdaFunctions", {
    cloudWatchLogsPolicy: testPolicy,
    scenariosDynamoDbPolicy: testDBPolicy,
    ecsTaskExecutionRoleArn: "arn:aws:iam:us-east-1:111122223333:roleArn",
    ecsTaskRoleArn: "arn:aws:iam:us-east-1:111122223333:roleTaskArn",
    ecsCluster: "testCluster",
    ecsTaskSecurityGroup: "testSecurityGroup",
    historyTable: testTable,
    historyDynamoDbPolicy: testDBPolicy,
    scenariosS3Policy: testS3Policy,
    subnetA: "testSubnetA",
    subnetB: "testSubnetB",
    solution,
    scenariosBucket: "testBucket",
    scenariosBucketArn: "testBucketArn",
    scenariosTable: testTable,
    uuid: "testId",
    mainStackRegion: "us-east-1",
    ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
  });
  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();

  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: testPolicy.document.toJSON(),
    Roles: Match.arrayWith([
      {
        Ref: "TaskRunnerLambdaFunctionsLambdaResultsRole1AF5AB18",
      },
      {
        Ref: "TaskRunnerLambdaFunctionsDLTTestLambdaTaskRoleCB13DE78",
      },
      {
        Ref: "TaskRunnerLambdaFunctionsLambdaTaskCancelerRoleEEC6795B",
      },
      {
        Ref: "TaskRunnerLambdaFunctionsTaskStatusRole4B498DE5",
      },
      {
        Ref: "TaskRunnerLambdaFunctionsTestCleanupRole5D7EE947",
      },
    ]),
  });

  Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
    Description: "Result parser for indexing xml test results to DynamoDB",
    Environment: {
      Variables: {
        AWS_ACCOUNT_ID: {
          Ref: "AWS::AccountId",
        },
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SCENARIOS_BUCKET: "testBucket",
        SCENARIOS_TABLE: {
          Ref: "TestTable5769773A",
        },
        SOLUTION_ID: solution.id,
        UUID: "testId",
        VERSION: solution.version,
      },
    },
    Handler: "index.handler",
    Role: {
      "Fn::GetAtt": ["TaskRunnerLambdaFunctionsLambdaResultsRole1AF5AB18", "Arn"],
    },
    Runtime: "nodejs24.x",
  });

  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: testDBPolicy.document.toJSON(),
    Roles: [
      {
        Ref: "TaskRunnerLambdaFunctionsLambdaResultsRole1AF5AB18",
      },
      {
        Ref: "TaskRunnerLambdaFunctionsDLTTestLambdaTaskRoleCB13DE78",
      },
      {
        Ref: "TaskRunnerLambdaFunctionsTaskStatusRole4B498DE5",
      },
    ],
  });

  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: testS3Policy.document.toJSON(),
    Roles: [
      {
        Ref: "TaskRunnerLambdaFunctionsLambdaResultsRole1AF5AB18",
      },
    ],
  });

  expect(testFunctions.resultsParser).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.taskRunner).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.taskCanceler).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.taskCancelerInvokePolicy).toBeInstanceOf(Policy);
  expect(testFunctions.taskStatusChecker).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.stabilizationChecker).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.startCommand).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.regionalSync).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.taskFailureHandler).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.orphanCleanup).toBeInstanceOf(NodejsFunction);
  expect(testFunctions.sfnFailureHandler).toBeInstanceOf(NodejsFunction);
});
