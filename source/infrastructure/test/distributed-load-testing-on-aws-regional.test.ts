// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { RegionalInfrastructureDLTStack } from "../lib/distributed-load-testing-on-aws-regional-stack";

const props = {
  codeBucket: "testbucket",
  codeVersion: "testversion",
  description: "Distributed Load Testing on AWS regional deployment.",
  publicECRRegistry: "testRegistry",
  publicECRTag: "testTag",
  solutionId: "testId",
  solutionName: "distributed-load-testing-on-aws",
  stackType: "regional",
  url: "http://testurl.com",
};

test("Distributed Load Testing Regional stack test", () => {
  const app = new App({
    context: {
      codeVersion: "testversion",
      solutionId: "SO0062",
      solutionName: "distributed-load-testing-on-aws",
    },
  });
  const stack = new RegionalInfrastructureDLTStack(app, "TestDLTRegionalStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
    ...props,
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
});
