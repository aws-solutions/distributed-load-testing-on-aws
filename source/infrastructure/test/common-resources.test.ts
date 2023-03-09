// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { CommonResourcesConstruct } from "../lib/common-resources/common-resources";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const common = new CommonResourcesConstruct(stack, "TestCommonResources", {
    sourceCodeBucket: "testbucketname",
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  expect(common.s3LogsBucket).toBeDefined();
  expect(common.sourceBucket).toBeDefined();
  expect(common.appRegistryApplication).toBeDefined();
});
