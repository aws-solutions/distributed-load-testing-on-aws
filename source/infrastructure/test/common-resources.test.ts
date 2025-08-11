// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { CommonResources } from "../lib/common-resources/common-resources";
import { Solution } from "../bin/solution";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { CustomResourceLambda } from "../lib/common-resources/custom-resource-lambda";
import { CfnApplication } from "aws-cdk-lib/aws-servicecatalogappregistry";
import { Policy } from "aws-cdk-lib/aws-iam";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  const common = new CommonResources(stack, "TestCommonResources", solution, "regional");

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(common.s3LogsBucket).toBeInstanceOf(Bucket);
  expect(common.customResourceLambda).toBeInstanceOf(CustomResourceLambda);
  expect(common.cloudWatchLogsPolicy).toBeInstanceOf(Policy);
});
