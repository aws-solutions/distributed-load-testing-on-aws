// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, CfnCondition, DefaultStackSynthesizer, Fn, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DLTConsoleAlbEcsConstruct } from "../lib/front-end/console-alb-ecs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";
import { ECR_IMAGE_URI_PATTERN } from "../lib/distributed-load-testing-on-aws-alb-ecs-stack";

test("DLT Console ALB ECS Construct Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");

  const stableTagCondition = new CfnCondition(stack, "UseStableTagCondition", {
    expression: Fn.conditionEquals("Yes", "Yes"),
  });

  const console = new DLTConsoleAlbEcsConstruct(stack, "TestConsoleResources", {
    s3LogsBucket: testSourceBucket,
    solutionId: "SO0062",
    buildFromSource: true,
    consoleDomainName: "test.example.com",
    certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    webConsoleImageUri: "",
    webConsoleZipKey: "dlt-web-console.zip",
    deployWaf: "Yes",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(console.webAppURL).toBeDefined();
  expect(console.consoleBucket).toBeDefined();
  expect(console.consoleBucketArn).toBeDefined();
});

test("DLT Console ALB ECS Construct - buildFromSource false with empty image URI (pull-through cache)", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  // Must use full public ECR URL format (public.ecr.aws/{alias}) because console-alb-ecs.ts
  // extracts the alias portion via .replace("public.ecr.aws/", "") for pull-through cache URIs.
  process.env.PUBLIC_ECR_REGISTRY = "public.ecr.aws/aws-solutions";
  process.env.PUBLIC_ECR_TAG = "tag";
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");

  const console = new DLTConsoleAlbEcsConstruct(stack, "TestConsoleResources", {
    s3LogsBucket: testSourceBucket,
    solutionId: "SO0062",
    buildFromSource: false,
    consoleDomainName: "test.example.com",
    certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    webConsoleImageUri: "",
    webConsoleZipKey: "dlt-web-console.zip",
    deployWaf: "Yes",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(console.webAppURL).toBeDefined();
  expect(console.consoleBucket).toBeDefined();
  expect(console.consoleBucketArn).toBeDefined();
});

test("DLT Console ALB ECS Construct - buildFromSource false with custom image URI", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  process.env.PUBLIC_ECR_REGISTRY = "public.ecr.aws/aws-solutions";
  process.env.PUBLIC_ECR_TAG = "tag";
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");

  const console = new DLTConsoleAlbEcsConstruct(stack, "TestConsoleResources", {
    s3LogsBucket: testSourceBucket,
    solutionId: "SO0062",
    buildFromSource: false,
    consoleDomainName: "test.example.com",
    certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    webConsoleImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-custom-repo:latest",
    webConsoleZipKey: "dlt-web-console.zip",
    deployWaf: "Yes",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  expect(console.webAppURL).toBeDefined();
  expect(console.consoleBucket).toBeDefined();
  expect(console.consoleBucketArn).toBeDefined();
});

test("DLT Console ALB ECS Construct - WAF disabled when deployWaf is No", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");

  new DLTConsoleAlbEcsConstruct(stack, "TestConsoleResources", {
    s3LogsBucket: testSourceBucket,
    solutionId: "SO0062",
    buildFromSource: true,
    consoleDomainName: "test.example.com",
    certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    webConsoleImageUri: "",
    webConsoleZipKey: "dlt-web-console.zip",
    deployWaf: "No",
  });

  const template = Template.fromStack(stack);

  // WAF condition should evaluate to false (No != Yes)
  template.hasCondition("TestConsoleResourcesDeployWAFCondition08FF7A22", {
    "Fn::Equals": ["No", "Yes"],
  });

  // WebACL and association should exist but with the WAF condition
  template.hasResource("AWS::WAFv2::WebACL", {
    Condition: "TestConsoleResourcesDeployWAFCondition08FF7A22",
  });
  template.hasResource("AWS::WAFv2::WebACLAssociation", {
    Condition: "TestConsoleResourcesDeployWAFCondition08FF7A22",
  });

  // ALB should exist without any condition
  template.hasResource("AWS::ElasticLoadBalancingV2::LoadBalancer", {
    Condition: Match.absent(),
  });
});

test("DLT Console ALB ECS Construct - WAF WebACL contains all expected rule groups", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const testSourceBucket = new Bucket(stack, "testSourceCodeBucket");

  new DLTConsoleAlbEcsConstruct(stack, "TestConsoleResources", {
    s3LogsBucket: testSourceBucket,
    solutionId: "SO0062",
    buildFromSource: true,
    consoleDomainName: "test.example.com",
    certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    webConsoleImageUri: "",
    webConsoleZipKey: "dlt-web-console.zip",
    deployWaf: "Yes",
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::WAFv2::WebACL", {
    Scope: "REGIONAL",
    Rules: Match.arrayWith([
      Match.objectLike({ Name: "AWSManagedRulesCommonRuleSet", Priority: 1 }),
      Match.objectLike({ Name: "AWSManagedRulesAmazonIpReputationList", Priority: 2 }),
      Match.objectLike({ Name: "AWSManagedRulesAnonymousIpList", Priority: 3 }),
    ]),
  });
});

describe("WebConsoleImageUri allowedPattern validation", () => {
  const pattern = new RegExp(ECR_IMAGE_URI_PATTERN);

  const validUris = [
    "",
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo",
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:latest",
    "123456789012.dkr.ecr.us-west-2.amazonaws.com/my-org/my-repo:v1.2.3",
    "123456789012.dkr.ecr.eu-central-1.amazonaws.com/repo",
    "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/repo:tag",
    "123456789012.dkr.ecr.us-gov-west-1.amazonaws.com/govcloud-repo:latest",
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo@sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  ];

  const invalidUris = [
    "docker.io/library/nginx:latest",
    "my-repo:latest",
    "12345.dkr.ecr.us-east-1.amazonaws.com/repo",
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/",
    "public.ecr.aws/abc123/my-repo:latest",
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/UPPER-CASE:latest",
    "not-a-uri",
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/repo@sha256:short",
  ];

  test.each(validUris)("accepts valid URI: '%s'", (uri) => {
    expect(uri).toMatch(pattern);
  });

  test.each(invalidUris)("rejects invalid URI: '%s'", (uri) => {
    expect(uri).not.toMatch(pattern);
  });
});
