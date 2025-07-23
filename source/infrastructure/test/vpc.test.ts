// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { FargateVpcConstruct } from "../lib/testing-resources/vpc";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT VPC Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const fargateVpc = new FargateVpcConstruct(stack, "TestVPC", "10.0.0.0/16");

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(fargateVpc.vpc).toBeInstanceOf(Vpc);
});
