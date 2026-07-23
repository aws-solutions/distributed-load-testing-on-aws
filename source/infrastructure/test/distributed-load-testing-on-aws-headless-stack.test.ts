// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DLTHeadlessStack } from "../lib/distributed-load-testing-on-aws-headless-stack";
import { Solution } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("Distributed Load Testing Headless stack test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const solution = new Solution("testId", "DLT", "testVersion", "headlessStackDescription");
  process.env.PUBLIC_ECR_REGISTRY = "registry";
  process.env.PUBLIC_ECR_TAG = "tag";
  process.env.DIST_OUTPUT_BUCKET = "codeBucket";
  process.env.SOLUTION_NAME = "DLT";
  process.env.VERSION = "Version";
  const stack = new DLTHeadlessStack(app, "TestDLTHeadlessStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
      imageAssetsRepositoryName: process.env.PUBLIC_ECR_REGISTRY,
      dockerTagPrefix: process.env.PUBLIC_ECR_TAG,
    }),
    solution,
    stackType: "main",
    solutionTemplate: "headless",
  });
  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
});
