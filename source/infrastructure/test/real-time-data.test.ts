// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { RealTimeDataConstruct } from "../lib/testing-resources/real-time-data";

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
  const testBucket = Bucket.fromBucketName(stack, "SourceCodeBucket", "testbucket");

  const realTimeData = new RealTimeDataConstruct(stack, "TestECS", {
    cloudWatchLogsPolicy: testPolicy,
    ecsCloudWatchLogGroup: testLogGroup,
    iotEndpoint: "iotEndpoint",
    mainRegion: "test-region-1",
    solutionId: "testID",
    solutionVersion: "testVersion",
    sourceCodeBucket: testBucket,
    sourceCodePrefix: "testPrefix",
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
    Code: {
      S3Bucket: "testbucket",
      S3Key: "testPrefix/real-time-data-publisher.zip",
    },
    Environment: {
      Variables: {
        MAIN_REGION: "test-region-1",
        IOT_ENDPOINT: "iotEndpoint",
        SOLUTION_ID: "testID",
        VERSION: "testVersion",
      },
    },
    Handler: "index.handler",
    Runtime: "nodejs18.x",
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
