// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { ScenarioTestRunnerStorageConstruct } from "../lib/back-end/scenarios-storage";
import { Bucket } from "aws-cdk-lib/aws-s3";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testLogsBucket = new Bucket(stack, "testLogsBucket");

  const storage = new ScenarioTestRunnerStorageConstruct(stack, "TestScenarioStorage", {
    s3LogsBucket: testLogsBucket,
    cloudFrontDomainName: "test.exampledomain.com",
    solutionId: "testId",
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  expect(storage.scenariosBucket).toBeDefined();
  expect(storage.scenariosS3Policy).toBeDefined();
  expect(storage.scenariosTable).toBeDefined();
  expect(storage.historyTable).toBeDefined();
  expect(storage.scenarioDynamoDbPolicy).toBeDefined();
  expect(storage.historyDynamoDbPolicy).toBeDefined();
});
