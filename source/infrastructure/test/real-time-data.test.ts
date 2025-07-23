// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { RealTimeDataConstruct } from "../lib/testing-resources/real-time-data";
import { Solution } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT real time data resources Test", () => {
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
  const testLogGroup = new LogGroup(stack, "TestLogsGroup");

  const solution = new Solution("testId", "DLT", "testVersion", "mainStackDescription");
  new RealTimeDataConstruct(stack, "TestECS", {
    cloudWatchLogsPolicy: testPolicy,
    ecsCloudWatchLogGroup: testLogGroup,
    iotEndpoint: "iotEndpoint",
    mainRegion: "test-region-1",
    solution,
  });

  expect(createTemplateWithoutS3Key(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
    Environment: {
      Variables: {
        MAIN_REGION: "test-region-1",
        IOT_ENDPOINT: "https://iotEndpoint",
        SOLUTION_ID: solution.id,
        VERSION: solution.version,
      },
    },
    Handler: "index.handler",
    Runtime: "nodejs20.x",
    Timeout: 180,
  });
  Template.fromStack(stack).hasResourceProperties("AWS::Logs::SubscriptionFilter", {
    FilterPattern: '"INFO: Current:" "live=true"',
  });
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
    Policies: [
      {
        PolicyDocument: {
          Statement: [
            {
              Action: "iot:Publish",
              Effect: "Allow",
              Resource: {
                "Fn::Join": [
                  "",
                  [
                    "arn:",
                    {
                      Ref: "AWS::Partition",
                    },
                    ":iot:test-region-1:",
                    {
                      Ref: "AWS::AccountId",
                    },
                    ":topic/*",
                  ],
                ],
              },
            },
          ],
        },
      },
    ],
  });
});
