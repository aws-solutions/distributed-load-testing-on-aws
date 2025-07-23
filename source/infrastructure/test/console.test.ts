// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack, CfnCondition, Aws, Fn } from "aws-cdk-lib";
import { DLTConsoleConstruct } from "../lib/front-end/console";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");

  const console = new DLTConsoleConstruct(stack, "TestConsoleResources", {
    s3LogsBucket: testSourceBucket,
    solutionId: "SO0062",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(console.webAppURL).toBeDefined();
  expect(console.consoleBucket).toBeDefined();
  expect(console.consoleBucketArn).toBeDefined();
});
