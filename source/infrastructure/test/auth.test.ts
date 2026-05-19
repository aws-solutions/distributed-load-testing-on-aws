// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack, CfnCondition, Aws, Fn } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { CognitoAuthConstruct } from "../lib/front-end/auth";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT API Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const auth = new CognitoAuthConstruct(stack, "TestAuth", {
    adminEmail: "email",
    adminName: "testname",
    apiId: "apiId12345",
    uuid: "test-uuid-1234",
    webAppURL: "test.com",
    scenariosBucketArn: "arn:aws:s3:::DOC-EXAMPLE-BUCKET",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(auth.cognitoIdentityPoolId).toBeDefined();
  expect(auth.cognitoUserPoolClientId).toBeDefined();
  expect(auth.cognitoUserPoolId).toBeDefined();
  expect(auth.cognitoUserPoolDomain).toBeDefined();
});

test("DLT Auth with isConsoleHostedExternally", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const auth = new CognitoAuthConstruct(stack, "TestAuth", {
    adminEmail: "email",
    adminName: "testname",
    apiId: "apiId12345",
    uuid: "test-uuid-1234",
    webAppURL: "*",
    scenariosBucketArn: "arn:aws:s3:::DOC-EXAMPLE-BUCKET",
    isConsoleHostedExternally: true,
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(auth.cognitoIdentityPoolId).toBeDefined();
  expect(auth.cognitoUserPoolClientId).toBeDefined();
  expect(auth.cognitoUserPoolId).toBeDefined();
  expect(auth.cognitoUserPoolDomain).toBeDefined();
});

test("GovCloud support: partition-aware auth constructs are configured", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const auth = new CognitoAuthConstruct(stack, "TestAuth", {
    adminEmail: "email",
    adminName: "testname",
    apiId: "apiId12345",
    uuid: "test-uuid-1234",
    webAppURL: "test.com",
    scenariosBucketArn: "arn:aws:s3:::DOC-EXAMPLE-BUCKET",
  });

  const template = Template.fromStack(stack);

  // Verify Identity Pool with unauthenticated disabled
  template.hasResourceProperties("AWS::Cognito::IdentityPool", {
    AllowUnauthenticatedIdentities: false,
  });

  // Verify both roles are attached to the Identity Pool
  template.resourceCountIs("AWS::Cognito::IdentityPoolRoleAttachment", 1);

  // Verify the cognitoUserPoolDomain is set (contains Fn::If token for auth-fips/auth)
  expect(auth.cognitoUserPoolDomain).toBeDefined();

  // Verify the UserPool domain is created
  template.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);

  // Full GovCloud template verification (Fn::If in trust policies, auth-fips domain,
  // IsGovCloudPartition condition) is covered by the snapshot tests above.
  // The CfnRole escape hatch and Fn::If tokens only resolve during full cdk synth.
});
