// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { RegionalInfrastructureDLTStack } from "../lib/distributed-load-testing-on-aws-regional-stack";
import { Solution } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("Distributed Load Testing Regional stack test", () => {
  const app = new App();
  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  process.env.PUBLIC_ECR_REGISTRY = "registry";
  process.env.PUBLIC_ECR_TAG = "tag";
  const stack = new RegionalInfrastructureDLTStack(app, "TestDLTRegionalStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
      imageAssetsRepositoryName: process.env.PUBLIC_ECR_REGISTRY,
      dockerTagPrefix: process.env.PUBLIC_ECR_TAG,
    }),
    solution,
    stackType: "regional",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
});
