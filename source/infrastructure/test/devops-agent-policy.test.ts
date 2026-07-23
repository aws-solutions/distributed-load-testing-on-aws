// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { DevOpsAgentConstruct } from "../lib/back-end/devops-agent";

test("DevOpsAgentConstruct grants GetAgentSpace with tag condition and task actions without", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "TestStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const construct = new DevOpsAgentConstruct(stack, "TestDevOpsAgentConstruct");

  const role = new Role(stack, "TestRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  role.attachInlinePolicy(construct.policy);

  expect(construct.policy).toBeDefined();

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Effect: "Allow",
          Action: "aidevops:GetAgentSpace",
          Condition: {
            StringEquals: {
              "aws:ResourceTag/dlt-integration": "allowed",
            },
          },
          Resource: {
            "Fn::Join": [
              "",
              [
                "arn:",
                { Ref: "AWS::Partition" },
                ":aidevops:*:",
                { Ref: "AWS::AccountId" },
                ":agentspace/*",
              ],
            ],
          },
        },
        {
          Effect: "Allow",
          Action: [
            "aidevops:CreateBacklogTask",
            "aidevops:GetBacklogTask",
            "aidevops:UpdateBacklogTask",
            "aidevops:ListExecutions",
            "aidevops:ListJournalRecords",
            "aidevops:CreateAsset",
            "aidevops:DeleteAsset",
          ],
          Resource: {
            "Fn::Join": [
              "",
              [
                "arn:",
                { Ref: "AWS::Partition" },
                ":aidevops:*:",
                { Ref: "AWS::AccountId" },
                ":agentspace/*",
              ],
            ],
          },
        },
      ],
    },
  });
});

test("DevOpsAgentConstruct has cfn_nag and cfn_guard suppressions for wildcard resource", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "TestStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const construct = new DevOpsAgentConstruct(stack, "TestDevOpsAgentConstruct");

  const role = new Role(stack, "TestRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  role.attachInlinePolicy(construct.policy);

  const template = Template.fromStack(stack);

  template.hasResource("AWS::IAM::Policy", {
    Metadata: Match.objectLike({
      cfn_nag: {
        rules_to_suppress: Match.arrayWith([
          Match.objectLike({ id: "W12" }),
        ]),
      },
      guard: {
        SuppressedRules: Match.arrayWith(["IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE"]),
      },
    }),
  });
});

test("DevOpsAgentConstruct creates AgentSpacesTable with correct schema", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "TestStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const construct = new DevOpsAgentConstruct(stack, "TestDevOpsAgentConstruct");

  expect(construct.agentSpacesTable).toBeDefined();
  expect(construct.agentSpacesDynamoDbPolicy).toBeDefined();

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::DynamoDB::Table", {
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
    SSESpecification: { SSEEnabled: true },
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
  });
});

test("DevOpsAgentConstruct creates InvestigationsTable with composite key", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "TestStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const construct = new DevOpsAgentConstruct(stack, "TestDevOpsAgentConstruct");

  expect(construct.investigationsTable).toBeDefined();
  expect(construct.investigationsDynamoDbPolicy).toBeDefined();

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::DynamoDB::Table", {
    KeySchema: [
      { AttributeName: "testId", KeyType: "HASH" },
      { AttributeName: "testRunId#investigationId", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    SSESpecification: { SSEEnabled: true },
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
  });
});

test("AgentSpacesDynamoDbPolicy grants correct DynamoDB actions", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "TestStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const construct = new DevOpsAgentConstruct(stack, "TestDevOpsAgentConstruct");

  const role = new Role(stack, "TestRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  role.attachInlinePolicy(construct.agentSpacesDynamoDbPolicy);

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "dynamodb:GetItem",
            "dynamodb:BatchGetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Scan",
          ],
          Resource: { "Fn::GetAtt": [Match.stringLikeRegexp("DLTAgentSpacesTable"), "Arn"] },
        },
      ],
    },
  });
});

test("InvestigationsDynamoDbPolicy grants correct DynamoDB actions", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "TestStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  const construct = new DevOpsAgentConstruct(stack, "TestDevOpsAgentConstruct");

  const role = new Role(stack, "TestRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  role.attachInlinePolicy(construct.investigationsDynamoDbPolicy);

  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
          ],
          Resource: { "Fn::GetAtt": [Match.stringLikeRegexp("DLTInvestigationsTable"), "Arn"] },
        },
      ],
    },
  });
});
