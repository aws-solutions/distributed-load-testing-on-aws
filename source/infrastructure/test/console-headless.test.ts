// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { DLTConsoleHeadlessConstruct } from "../lib/front-end/console-headless";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT Console Headless Construct Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");

  const console = new DLTConsoleHeadlessConstruct(stack, "TestConsoleResources", {
    s3LogsBucket: testSourceBucket,
    solutionId: "SO0062",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(console.webAppURL).toBe("*");
  expect(console.consoleBucket).toBeDefined();
  expect(console.consoleBucketArn).toBeDefined();
  expect(console.isConsoleHostedExternally).toBe(true);
});
