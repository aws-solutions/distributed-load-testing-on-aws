// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, CfnCondition, DefaultStackSynthesizer, Fn, Stack } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CustomResourcesConstruct } from "../lib/custom-resources/custom-resources";
import { CustomResourceInfraConstruct } from "../lib/custom-resources/custom-resources-infra";
import { Template } from "aws-cdk-lib/assertions";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");
  const testPolicy = new Policy(stack, "TestPolicy", {
    statements: [
      new PolicyStatement({
        resources: ["*"],
        actions: ["cloudwatch:Get*"],
      }),
    ],
  });

  const testCustomResourceInfra = new CustomResourceInfraConstruct(stack, "TestCustomResourceInfra", {
    cloudWatchPolicy: testPolicy,
    consoleBucketArn: "test:console:bucket:arn",
    mainStackRegion: "test-region-1",
    metricsUrl: "http://testurl.com",
    scenariosS3Bucket: "scenariotestbucket",
    scenariosTable: "scenarioTestTable",
    solutionId: "S0XXX",
    solutionVersion: "testVersion",
    sourceCodeBucket: testSourceBucket,
    sourceCodePrefix: "test/source/prefix",
    stackType: "main",
  });

  const sendAnonymizedUsageCondition = new CfnCondition(stack, "condition", {
    expression: Fn.conditionIf("testCondition", true, false),
  });
  const boolExistingVpc = "false";

  const customResources = new CustomResourcesConstruct(stack, "DLTCustomResources", {
    customResourceLambdaArn: testCustomResourceInfra.customResourceArn,
  });

  customResources.copyConsoleFiles({
    consoleBucketName: "testconsolebucket",
    scenariosBucket: "testscenariosbucket",
    sourceCodeBucketName: "testcodebucket",
    sourceCodePrefix: "testCodePrefix/",
  });

  customResources.consoleConfig({
    apiEndpoint: "http://testEndpointUrl.com",
    cognitoIdentityPool: "testIdentityPool",
    cognitoUserPool: "testUserPool",
    cognitoUserPoolClient: "testUserPoolClient",
    consoleBucketName: "testconsolebucket",
    scenariosBucket: "testscenariobucket",
    sourceCodeBucketName: "sourcebucket",
    sourceCodePrefix: "sourcecode/prefix",
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
    uuid: "abc-123-def-456",
  });

  customResources.sendAnonymizedMetricsCR({
    existingVpc: boolExistingVpc,
    solutionId: "testId",
    uuid: "abc-123-def-456",
    solutionVersion: "testVersion",
    sendAnonymizedUsage: "Yes",
    sendAnonymizedUsageCondition,
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::CloudFormation::CustomResource", {
    Resource: "CopyAssets",
  });
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
