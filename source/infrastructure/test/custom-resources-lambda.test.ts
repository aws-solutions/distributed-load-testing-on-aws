// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { CustomResourceLambda } from "../lib/common-resources/custom-resource-lambda";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  new CustomResourceLambda(stack, "TestCustomResourceInfra", solution, "main");

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
    Description: "CFN Lambda backed custom resource to deploy assets to s3",
    Environment: {
      Variables: {
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SOLUTION_ID: solution.id,
        VERSION: solution.version,
      },
    },
    Handler: "index.handler",
    Runtime: "nodejs20.x",
    Timeout: 120,
  });
});
