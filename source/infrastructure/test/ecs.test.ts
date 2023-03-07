// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ECSResourcesConstruct } from "../lib/testing-resources/ecs";

test("DLT ECS Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
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
  const ecs = new ECSResourcesConstruct(stack, "TestECS", {
    cloudWatchLogsPolicy: testPolicy,
    containerImage: "testRepository/testImage:testTag",
    fargateVpcId: "vpc-1a2b3c4d5e",
    scenariosS3Bucket: "testscenariobucket",
    securityGroupEgress: "0.0.0.0/0",
    solutionId: "SO0062",
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
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
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
    GroupId: {
      Ref: "TestECSDLTEcsSecurityGroupFE5016DC",
    },
    SourceSecurityGroupId: {
      Ref: "TestECSDLTEcsSecurityGroupFE5016DC",
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroupEgress", {
    Description: "Allow tasks to call out to external resources",
  });
  expect(ecs.taskClusterName).toBeDefined();
  expect(ecs.ecsCloudWatchLogGroup).toBeDefined();
  expect(ecs.taskDefinitionArn).toBeDefined();
  expect(ecs.taskExecutionRoleArn).toBeDefined();
  expect(ecs.ecsSecurityGroupId).toBeDefined();
});
