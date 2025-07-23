// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DLTStack } from "../lib/distributed-load-testing-on-aws-stack";
import { Solution } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("Distributed Load Testing stack test", () => {
  const app = new App();
  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  process.env.PUBLIC_ECR_REGISTRY = "registry";
  process.env.PUBLIC_ECR_TAG = "tag";
  process.env.DIST_OUTPUT_BUCKET = "codeBucket";
  process.env.SOLUTION_NAME = "DLT";
  process.env.VERSION = "Version";
  const stack = new DLTStack(app, "TestDLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
      imageAssetsRepositoryName: process.env.PUBLIC_ECR_REGISTRY,
      dockerTagPrefix: process.env.PUBLIC_ECR_TAG,
    }),
    solution,
    stackType: "main",
  });
  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
});
