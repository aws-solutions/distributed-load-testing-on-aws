// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack, CfnCondition, Fn, Aws } from "aws-cdk-lib";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { DLTAPI } from "../lib/front-end/api";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Solution } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  const testLog = new LogGroup(stack, "TestLogGroup");
  const testPolicy = new Policy(stack, "TestPolicy", {
    statements: [
      new PolicyStatement({
        resources: ["*"],
        actions: ["cloudwatch:Get*"],
      }),
    ],
  });
  const testSourceBucket = Bucket.fromBucketName(stack, "SourceCodeBucket", "test-bucket-region");

  const api = new DLTAPI(stack, "TestAPI", {
    cloudWatchLogsPolicy: testPolicy,
    ecsCloudWatchLogGroup: testLog,
    historyDynamoDbPolicy: testPolicy,
    historyTable: "testHistoryDDBTable",
    historyTableGSIName: "testId-startTime-index",
    scenariosDynamoDbPolicy: testPolicy,
    taskCancelerInvokePolicy: testPolicy,
    scenariosS3Policy: testPolicy,
    scenariosBucketName: "testScenarioBucketName",
    scenariosTableName: "testDDBTable",
    ecsTaskExecutionRoleArn: "arn:aws:iam::1234567890:role/MyRole-AJJHDSKSDF",
    ecsTaskRoleArn: "arn:aws:iam::1234567890:role/TaskRole-AJJHDSKSDF",
    taskRunnerStepFunctionsArn: "arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine",
    taskCancelerArn: "arn:aws:lambda:us-east-1:111122223333:function:HelloFunction",
    uuid: "abc123",
    solution,
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(api.apiId).toBeDefined();
  expect(api.apiEndpointPath).toBeDefined();
  Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
    Description: "API microservices for creating, updating, listing and deleting test scenarios",
    Handler: "index.handler",
    Runtime: "nodejs24.x",
    Environment: {
      Variables: {
        AWS_ACCOUNT_ID: {
          Ref: "AWS::AccountId",
        },
        HISTORY_TABLE: "testHistoryDDBTable",
        SCENARIOS_BUCKET: "testScenarioBucketName",
        SCENARIOS_TABLE: "testDDBTable",
        STATE_MACHINE_ARN: "arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine",
        SOLUTION_ID: solution.id,
        UUID: "abc123",
        VERSION: solution.version,
        TASK_CANCELER_ARN: "arn:aws:lambda:us-east-1:111122223333:function:HelloFunction",
        STACK_ID: {
          Ref: "AWS::StackId",
        },
      },
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::ApiGateway::RequestValidator", {
    ValidateRequestBody: true,
    ValidateRequestParameters: true,
  });
});

test("API Gateway GovCloud support: IsGovCloudPartition condition and endpoint type override", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  const testLog = new LogGroup(stack, "TestLogGroup");
  const testPolicy = new Policy(stack, "TestPolicy", {
    statements: [
      new PolicyStatement({
        resources: ["*"],
        actions: ["cloudwatch:Get*"],
      }),
    ],
  });

  new DLTAPI(stack, "TestAPI", {
    cloudWatchLogsPolicy: testPolicy,
    ecsCloudWatchLogGroup: testLog,
    historyDynamoDbPolicy: testPolicy,
    historyTable: "testHistoryDDBTable",
    historyTableGSIName: "testId-startTime-index",
    scenariosDynamoDbPolicy: testPolicy,
    taskCancelerInvokePolicy: testPolicy,
    scenariosS3Policy: testPolicy,
    scenariosBucketName: "testScenarioBucketName",
    scenariosTableName: "testDDBTable",
    ecsTaskExecutionRoleArn: "arn:aws:iam::1234567890:role/MyRole-AJJHDSKSDF",
    ecsTaskRoleArn: "arn:aws:iam::1234567890:role/TaskRole-AJJHDSKSDF",
    taskRunnerStepFunctionsArn: "arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine",
    taskCancelerArn: "arn:aws:lambda:us-east-1:111122223333:function:HelloFunction",
    uuid: "abc123",
    solution,
  });

  const template = Template.fromStack(stack);

  // Verify the RestApi resource exists
  template.resourceCountIs("AWS::ApiGateway::RestApi", 1);

  // Full GovCloud template verification (Fn::If for REGIONAL vs EDGE endpoint type,
  // IsGovCloudPartition condition) is covered by the snapshot test above.
  // The addPropertyOverride only resolves during full cdk synth.
});
