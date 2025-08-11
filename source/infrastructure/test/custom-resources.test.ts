// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, CfnCondition, DefaultStackSynthesizer, Fn, Stack } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { CustomResourcesConstruct } from "../lib/common-resources/custom-resources";
import { Template } from "aws-cdk-lib/assertions";
import { CustomResourceLambda } from "../lib/common-resources/custom-resource-lambda";
import { Solution } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");

  const testCustomResourceLambda = new CustomResourceLambda(stack, "TestCustomResourceInfra", solution, "main");

  const sendAnonymizedUsageCondition = new CfnCondition(stack, "condition", {
    expression: Fn.conditionIf("testCondition", true, false),
  });
  const boolExistingVpc = "false";

  const customResources = new CustomResourcesConstruct(
    stack,
    "DLTCustomResources",
    testCustomResourceLambda.nodejsLambda
  );

  const testBucket = new Bucket(stack, "testConsoleBucket");
  customResources.consoleConfig({
    apiEndpoint: "http://testEndpointUrl.com",
    cognitoIdentityPool: "testIdentityPool",
    cognitoUserPool: "testUserPool",
    cognitoUserPoolClient: "testUserPoolClient",
    consoleBucket: testBucket,
    scenariosBucket: "testscenariobucket",
    iotEndpoint: "testIoTEndpoint",
    iotPolicy: "testIoTPolicy",
  });

  customResources.testingResourcesConfigCR({
    taskCluster: "testTaskCluster",
    ecsCloudWatchLogGroup: "testCloudWatchLogGroup",
    taskSecurityGroup: "sg-test123",
    taskDefinition: "task:def:arn:123",
    subnetA: "subnet-123",
    subnetB: "subnet-abc",
  });

  customResources.sendAnonymizedMetricsCR({
    existingVpc: boolExistingVpc,
    solutionId: "testId",
    uuid: "abc-123-def-456",
    solutionVersion: "testVersion",
    sendAnonymizedUsage: "Yes",
    sendAnonymizedUsageCondition,
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::CloudFormation::CustomResource", {
    Resource: "ConfigFile",
  });
  Template.fromStack(stack).hasResourceProperties("AWS::CloudFormation::CustomResource", {
    Resource: "TestingResourcesConfigFile",
  });
  Template.fromStack(stack).hasResourceProperties("AWS::CloudFormation::CustomResource", {
    Resource: "AnonymizedMetric",
  });
});
