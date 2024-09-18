// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DLTStack } from "../lib/distributed-load-testing-on-aws-stack";

const props = {
  codeBucket: "testbucket",
  codeVersion: "testversion",
  description:
    "Distributed Load Testing on AWS is a reference architecture to perform application load testing at scale.",
  publicECRRegistry: "testRegistry",
  publicECRTag: "testTag",
  solutionId: "SO0062",
  solutionName: "distributed-load-testing-on-aws",
  stackType: "main",
  url: "http://testurl.com",
};

test("Distributed Load Testing stack test", () => {
  const app = new App({
    context: {
      codeVersion: "testversion",
      solutionId: "SO0062",
      solutionName: "distributed-load-testing-on-aws",
    },
  });
  const stack = new DLTStack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
    ...props,
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
});
