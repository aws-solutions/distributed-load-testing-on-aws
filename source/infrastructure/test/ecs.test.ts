// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, CfnCondition, DefaultStackSynthesizer, Fn, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
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
    loadTesterImageUri: "",
    locustLoadTesterImageUri: "",
    k6LoadTesterImageUri: "",
    jmeterLoadTesterImageUri: "",
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::ECS::Cluster", {
    ClusterSettings: [{ Name: "containerInsights", Value: "enabled" }],
  });
  template.resourceCountIs("AWS::ECS::TaskDefinition", 4);
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    Cpu: "2048",
    Memory: "4096",
    NetworkMode: "awsvpc",
    RequiresCompatibilities: ["FARGATE"],
  });
  const synthesized = template.toJSON();
  expect(Object.keys(synthesized.Conditions)).toEqual(
    expect.arrayContaining([
      "UsePublicLoadTestingImageCondition",
      "UsePublicK6LoadTestingImageCondition",
      "UsePublicLocustLoadTestingImageCondition",
      "UsePublicJMeterLoadTestingImageCondition",
    ])
  );
  const taskDefinitions = JSON.stringify(template.findResources("AWS::ECS::TaskDefinition"));
  expect(taskDefinitions).toContain("distributed-load-testing-on-aws-load-tester:tag");
  expect(taskDefinitions).toContain("distributed-load-testing-on-aws-load-tester-k6:tag");
  expect(taskDefinitions).toContain("distributed-load-testing-on-aws-load-tester-locust:tag");
  expect(taskDefinitions).toContain("distributed-load-testing-on-aws-load-tester-jmeter:tag");
  const k6TaskDefinition = Object.entries(template.findResources("AWS::ECS::TaskDefinition")).find(([logicalId]) =>
    logicalId.includes("K6DLTTaskDefinition")
  )?.[1] as any;
  expect(k6TaskDefinition).toBeDefined();
  const k6Container = k6TaskDefinition.Properties.ContainerDefinitions[0];
  expect(k6Container.HealthCheck.StartPeriod).toBe(180);
  expect(k6Container.StopTimeout).toBe(120);
  // Native JMeter tasks are cloned from this task definition, so the heap it sets
  // is the heap every JMeter task gets. Without it the JVM would fall back to
  // bin/jmeter's own -Xms1g -Xmx1g.
  const jmeterTaskDefinition = Object.entries(template.findResources("AWS::ECS::TaskDefinition")).find(([logicalId]) =>
    logicalId.includes("JMeterDLTTaskDefinition")
  )?.[1] as any;
  expect(jmeterTaskDefinition).toBeDefined();
  const jmeterContainer = jmeterTaskDefinition.Properties.ContainerDefinitions[0];
  expect(jmeterContainer.Environment).toEqual(
    expect.arrayContaining([
      {
        Name: "JVM_ARGS",
        Value: "-Xms1g -Xmx3g -XX:+ExitOnOutOfMemoryError -XX:-HeapDumpOnOutOfMemoryError",
      },
    ])
  );
  expect(jmeterContainer.HealthCheck.StartPeriod).toBe(120);
  expect(jmeterContainer.StopTimeout).toBe(120);
  for (const taskDefinition of Object.values(template.findResources("AWS::ECS::TaskDefinition")) as any[]) {
    expect(taskDefinition.Properties.ContainerDefinitions[0].StopTimeout).toBe(120);
  }
  template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
  template.hasResourceProperties("AWS::IAM::Role", {
    Policies: Match.arrayWith([
      Match.objectLike({
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["s3:AbortMultipartUpload"]),
            }),
          ]),
        },
      }),
    ]),
  });
  expect(ecs.taskClusterName).toBeDefined();
  expect(ecs.ecsCloudWatchLogGroup).toBeDefined();
  expect(ecs.taskDefinitionArn).toBeDefined();
  expect(ecs.locustTaskDefinitionArn).toBeDefined();
  expect(ecs.k6TaskDefinitionArn).toBeDefined();
  expect(ecs.jmeterTaskDefinitionArn).toBeDefined();
  expect(ecs.taskExecutionRoleArn).toBeDefined();
  expect(ecs.taskRoleArn).toBeDefined();
  expect(ecs.ecsSecurityGroupId).toBeDefined();
});

test("DLT ECS Hub Test - independent private image URIs", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTPrivateImageStack");
  const vpc = new Vpc(stack, "TestVPC");
  const stableTagCondition = new CfnCondition(stack, "UseStableTagCondition", {
    expression: Fn.conditionEquals("No", "Yes"),
  });

  new ECSResourcesConstruct(stack, "TestECS", {
    containerMode: "hub",
    fargateVpcId: vpc.vpcId,
    scenariosS3Bucket: "testscenariobucket",
    securityGroupEgress: "0.0.0.0/0",
    solutionId: "SO0062",
    stableTagCondition: stableTagCondition.logicalId,
    buildFromSource: false,
    loadTesterImageUri: "111111111111.dkr.ecr.us-east-1.amazonaws.com/taurus:test",
    locustLoadTesterImageUri: "222222222222.dkr.ecr.us-east-1.amazonaws.com/locust:test",
    k6LoadTesterImageUri: "333333333333.dkr.ecr.us-east-1.amazonaws.com/k6:test",
    jmeterLoadTesterImageUri: "444444444444.dkr.ecr.us-east-1.amazonaws.com/jmeter:test",
  });

  const taskDefinitions = JSON.stringify(Template.fromStack(stack).findResources("AWS::ECS::TaskDefinition"));
  expect(taskDefinitions).toContain("111111111111.dkr.ecr.us-east-1.amazonaws.com/taurus:test");
  expect(taskDefinitions).toContain("222222222222.dkr.ecr.us-east-1.amazonaws.com/locust:test");
  expect(taskDefinitions).toContain("333333333333.dkr.ecr.us-east-1.amazonaws.com/k6:test");
  expect(taskDefinitions).toContain("444444444444.dkr.ecr.us-east-1.amazonaws.com/jmeter:test");
});

test("DLT ECS Hub Test - source build creates distinct image assets", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "DLTSourceImageStack");
  const vpc = new Vpc(stack, "TestVPC");
  const stableTagCondition = new CfnCondition(stack, "UseStableTagCondition", {
    expression: Fn.conditionEquals("No", "Yes"),
  });

  new ECSResourcesConstruct(stack, "TestECS", {
    containerMode: "hub",
    fargateVpcId: vpc.vpcId,
    scenariosS3Bucket: "testscenariobucket",
    securityGroupEgress: "0.0.0.0/0",
    solutionId: "SO0062",
    stableTagCondition: stableTagCondition.logicalId,
    buildFromSource: true,
    loadTesterImageUri: "",
    locustLoadTesterImageUri: "",
    k6LoadTesterImageUri: "",
    jmeterLoadTesterImageUri: "",
  });

  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::ECS::TaskDefinition", 4);
  const taskDefinitions = Object.values(template.findResources("AWS::ECS::TaskDefinition")) as any[];
  const images = taskDefinitions.map(
    (taskDefinition) => taskDefinition.Properties.ContainerDefinitions[0].Image["Fn::Sub"]
  );
  expect(images).toHaveLength(4);
  for (const image of images) {
    expect(image).toContain("container-assets");
  }
  expect(new Set(images).size).toBe(4);
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
  expect(ecs.locustTaskDefinitionArn).toBeUndefined();
  expect(ecs.k6TaskDefinitionArn).toBeUndefined();
  expect(ecs.jmeterTaskDefinitionArn).toBeUndefined();
  expect(ecs.taskExecutionRoleArn).toBeDefined();
  expect(ecs.taskRoleArn).toBeDefined();
  expect(ecs.ecsSecurityGroupId).toBeDefined();
});
