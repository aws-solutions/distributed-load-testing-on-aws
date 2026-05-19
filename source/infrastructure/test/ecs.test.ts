// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, CfnCondition, DefaultStackSynthesizer, Fn, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ECSResourcesConstruct } from "../lib/testing-resources/ecs";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT ECS Hub Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  process.env.PUBLIC_ECR_REGISTRY = "registry";
  process.env.PUBLIC_ECR_TAG = "tag";
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
      imageAssetsRepositoryName: process.env.PUBLIC_ECR_REGISTRY,
      dockerTagPrefix: process.env.PUBLIC_ECR_TAG,
    }),
  });
  const testPolicy = new Policy(stack, "TestPolicy", {
    statements: [
      new PolicyStatement({
        resources: ["*"],
        actions: ["cloudwatch:Get*"],
      }),
    ],
  });
  const vpc = new Vpc(stack, "TestVPC");

  const stableTagCondition = new CfnCondition(stack, "UseStableTagCondition", {
    expression: Fn.conditionEquals("Yes", "Yes"),
  });

  const ecs = new ECSResourcesConstruct(stack, "TestECS", {
    containerMode: "hub",
    fargateVpcId: vpc.vpcId,
    scenariosS3Bucket: "testscenariobucket",
    securityGroupEgress: "0.0.0.0/0",
    solutionId: "SO0062",
    stableTagCondition: stableTagCondition.logicalId,
    buildFromSource: false,
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::ECS::Cluster", {
    ClusterSettings: [{ Name: "containerInsights", Value: "enabled" }],
  });
  Template.fromStack(stack).hasResourceProperties("AWS::ECS::TaskDefinition", {
    Cpu: "2048",
    Memory: "4096",
    NetworkMode: "awsvpc",
    RequiresCompatibilities: ["FARGATE"],
  });
  Template.fromStack(stack).resourceCountIs("AWS::EC2::SecurityGroup", 1);
  expect(ecs.taskClusterName).toBeDefined();
  expect(ecs.ecsCloudWatchLogGroup).toBeDefined();
  expect(ecs.taskDefinitionArn).toBeDefined();
  expect(ecs.taskExecutionRoleArn).toBeDefined();
  expect(ecs.taskRoleArn).toBeDefined();
  expect(ecs.ecsSecurityGroupId).toBeDefined();
});

test("DLT ECS Regional Test — no task definition", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTRegionalStack");
  const vpc = new Vpc(stack, "TestVPC");

  const ecs = new ECSResourcesConstruct(stack, "TestECS", {
    containerMode: "regional",
    fargateVpcId: vpc.vpcId,
    scenariosS3Bucket: "testscenariobucket",
    securityGroupEgress: "0.0.0.0/0",
    solutionId: "SO0062",
  });

  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::ECS::Cluster", {
    ClusterSettings: [{ Name: "containerInsights", Value: "enabled" }],
  });
  template.resourceCountIs("AWS::ECS::TaskDefinition", 0);
  template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
  expect(ecs.taskClusterName).toBeDefined();
  expect(ecs.ecsCloudWatchLogGroup).toBeDefined();
  expect(ecs.taskDefinitionArn).toBeUndefined();
  expect(ecs.taskExecutionRoleArn).toBeDefined();
  expect(ecs.taskRoleArn).toBeDefined();
  expect(ecs.ecsSecurityGroupId).toBeDefined();
});
