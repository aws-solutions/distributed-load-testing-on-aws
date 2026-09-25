// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { RealTimeDataConstruct } from "../lib/testing-resources/real-time-data";
import { Solution } from "../bin/solution";
import { createTemplateWithoutS3Key } from "./snapshot_helpers";

test("DLT real time data resources Test", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
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
    Runtime: "nodejs24.x",
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
                    ":topic/dlt/*",
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

test("subscription filter terms all appear in the native-mode live-data marker", () => {
  // Native-mode containers emit JSON lines carrying LIVE_DATA_FILTER_MARKER
  // as a field value so they match this plain-text filter without a filter
  // change. infrastructure does not depend on @amzn/dlt-common, so read the
  // constant as text.
  const schemaSource = readFileSync(join(__dirname, "../../common/src/schemas/live-data.ts"), "utf8");
  const sentinel = /LIVE_DATA_FILTER_MARKER = "([^"]+)"/.exec(schemaSource)?.[1];

  expect(sentinel).toBeDefined();
  for (const term of ["INFO: Current:", "live=true"]) {
    expect(sentinel).toContain(term);
  }
});
