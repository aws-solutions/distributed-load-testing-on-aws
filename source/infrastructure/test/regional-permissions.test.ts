// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { RegionalPermissionsConstruct } from "../lib/testing-resources/regional-permissions";

test("DLT Regional Permission Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });

  new RegionalPermissionsConstruct(stack, "TestRegionalPermissions", {
    apiServicesLambdaRoleName: "testApiServicesLambdaRoleName",
    resultsParserRoleName: "testResultsParserRoleName",
    taskExecutionRoleArn: "arn:aws:iam::123456789012:role/testRole",
    ecsCloudWatchLogGroupArn: "arn:aws:logs:us-east-2:123456789012:log-group:test_log_group_name",
    taskRunnerRoleName: "testTaskRunnerRoleName",
    taskCancelerRoleName: "testTaskCancelerRoleName",
    taskStatusCheckerRoleName: "testTaskStatusCheckerRoleName",
  });
  expect(Template.fromStack(stack)).toMatchSnapshot();
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: ["ecs:RunTask", "ecs:DescribeTasks", "ecs:TagResource"],
          Effect: "Allow",
          Resource: [
            {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  {
                    Ref: "AWS::Partition",
                  },
                  ":ecs:",
                  {
                    Ref: "AWS::Region",
                  },
                  ":",
                  {
                    Ref: "AWS::AccountId",
                  },
                  ":task/*",
                ],
              ],
            },
            {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  {
                    Ref: "AWS::Partition",
                  },
                  ":ecs:",
                  {
                    Ref: "AWS::Region",
                  },
                  ":",
                  {
                    Ref: "AWS::AccountId",
                  },
                  ":task-definition/*:*",
                ],
              ],
            },
          ],
        },
        {
          Action: "iam:PassRole",
          Effect: "Allow",
          Resource: "arn:aws:iam::123456789012:role/testRole",
        },
      ],
      Version: "2012-10-17",
    },
    PolicyName: {
      "Fn::Join": [
        "",
        [
          "RegionalECRPerms-",
          {
            Ref: "AWS::StackName",
          },
          "-",
          {
            Ref: "AWS::Region",
          },
        ],
      ],
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: "logs:PutMetricFilter",
          Effect: "Allow",
          Resource: "arn:aws:logs:us-east-2:123456789012:log-group:test_log_group_name",
        },
      ],
      Version: "2012-10-17",
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: "logs:DeleteMetricFilter",
          Effect: "Allow",
          Resource: "arn:aws:logs:us-east-2:123456789012:log-group:test_log_group_name",
        },
      ],
      Version: "2012-10-17",
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: "ecs:StopTask",
          Effect: "Allow",
          Resource: [
            {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  {
                    Ref: "AWS::Partition",
                  },
                  ":ecs:",
                  {
                    Ref: "AWS::Region",
                  },
                  ":",
                  {
                    Ref: "AWS::AccountId",
                  },
                  ":task/*",
                ],
              ],
            },
            {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  {
                    Ref: "AWS::Partition",
                  },
                  ":ecs:",
                  {
                    Ref: "AWS::Region",
                  },
                  ":",
                  {
                    Ref: "AWS::AccountId",
                  },
                  ":task-definition/*:*",
                ],
              ],
            },
          ],
        },
      ],
      Version: "2012-10-17",
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: "ecs:DescribeTasks",
          Effect: "Allow",
          Resource: {
            "Fn::Join": [
              "",
              [
                "arn:",
                {
                  Ref: "AWS::Partition",
                },
                ":ecs:",
                {
                  Ref: "AWS::Region",
                },
                ":",
                {
                  Ref: "AWS::AccountId",
                },
                ":task/*",
              ],
            ],
          },
        },
      ],
      Version: "2012-10-17",
    },
  });
});
