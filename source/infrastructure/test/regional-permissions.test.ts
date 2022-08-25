// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from 'aws-cdk-lib';
import { RegionalPermissionsConstruct } from '../lib/testing-resources/regional-permissions';

test('DLT Regional Permission Test', () => {
  const stack = new Stack();

  new RegionalPermissionsConstruct(stack, 'TestRegionalPermissions', {
    apiServicesLambdaRoleName: 'testApiServicesLambdaRoleName',
    resultsParserRoleName: 'testResultsParserRoleName',
    taskExecutionRoleArn: 'arn:aws:iam::123456789012:role/testRole',
    ecsCloudWatchLogGroupArn: 'arn:aws:logs:us-east-2:123456789012:log-group:test_log_group_name',
    taskRunnerRoleName: 'testTaskRunnerRoleName',
    taskCancelerRoleName: 'testTaskCancelerRoleName',
    taskStatusCheckerRoleName: 'testTaskStatusCheckerRoleName'
  });
  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
  expect(stack).toHaveResourceLike("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: [
            "ecs:RunTask",
            "ecs:DescribeTasks",
          ],
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
          }
        ]
      ]
    }
  });
  expect(stack).toHaveResourceLike("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: "logs:PutMetricFilter",
          Effect: "Allow",
          Resource: "arn:aws:logs:us-east-2:123456789012:log-group:test_log_group_name",
        },
      ],
      Version: "2012-10-17",
    }
  });
  expect(stack).toHaveResourceLike("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: "logs:DeleteMetricFilter",
          Effect: "Allow",
          Resource: "arn:aws:logs:us-east-2:123456789012:log-group:test_log_group_name",
        },
      ],
      Version: "2012-10-17",
    }
  });
  expect(stack).toHaveResourceLike("AWS::IAM::Policy", {
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
    }
  });
  expect(stack).toHaveResourceLike("AWS::IAM::Policy", {
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
    }
  });
});