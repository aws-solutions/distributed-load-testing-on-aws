// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ECSResourcesConstruct } from "../lib/testing-resources/ecs";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT ECS Test", () => {
  const app = new App();
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
  const ecs = new ECSResourcesConstruct(stack, "TestECS", {
    fargateVpc: vpc,
    scenariosS3Bucket: "testscenariobucket",
    securityGroupEgress: "0.0.0.0/0",
    solutionId: "SO0062",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::ECS::Cluster", {
    ClusterSettings: [
      {
        Name: "containerInsights",
        Value: "enabled",
      },
    ],
  });
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
        },
      ],
      Version: "2012-10-17",
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
    RetentionInDays: 365,
  });
  Template.fromStack(stack).hasResourceProperties("AWS::ECS::TaskDefinition", {
    Cpu: "2048",
    Memory: "4096",
    NetworkMode: "awsvpc",
    RequiresCompatibilities: ["FARGATE"],
  });
  Template.fromStack(stack).resourceCountIs("AWS::EC2::SecurityGroup", 1);
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
    SecurityGroupEgress: [
      {
        CidrIp: "0.0.0.0/0",
        IpProtocol: "-1",
      },
    ],
  });
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
    FromPort: 50000,
    ToPort: 50000,
  });
  expect(ecs.taskClusterName).toBeDefined();
  expect(ecs.ecsCloudWatchLogGroup).toBeDefined();
  expect(ecs.taskDefinitionArn).toBeDefined();
  expect(ecs.taskExecutionRoleArn).toBeDefined();
  expect(ecs.ecsSecurityGroupId).toBeDefined();
});
