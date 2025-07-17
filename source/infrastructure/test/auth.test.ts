// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack, CfnCondition, Aws, Fn } from "aws-cdk-lib";

import { CognitoAuthConstruct } from "../lib/front-end/auth";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const auth = new CognitoAuthConstruct(stack, "TestAuth", {
    adminEmail: "email",
    adminName: "testname",
    apiId: "apiId12345",
    webAppURL: "test.com",
    scenariosBucketArn: "arn:aws:s3:::DOC-EXAMPLE-BUCKET",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(auth.cognitoIdentityPoolId).toBeDefined();
  expect(auth.cognitoUserPoolClientId).toBeDefined();
  expect(auth.cognitoUserPoolId).toBeDefined();
});
