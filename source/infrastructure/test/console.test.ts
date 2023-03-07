// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { DLTConsoleConstruct } from "../lib/front-end/console";
import { Bucket } from "aws-cdk-lib/aws-s3";

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
    solutionId: "testId",
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  expect(console.cloudFrontDomainName).toBeDefined();
  expect(console.consoleBucket).toBeDefined();
  expect(console.consoleBucketArn).toBeDefined();
});
