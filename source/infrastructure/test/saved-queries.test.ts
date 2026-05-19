// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Match, Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { SavedQueriesConstruct } from "../lib/back-end/saved-queries";

test("SavedQueriesConstruct creates 4 query definitions with deploy-time names", () => {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new Stack(app, "TestStack", {
    synthesizer: new DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
    env: { region: "us-west-2", account: "123456789012" },
  });

  const logGroups = Array.from({ length: 10 }, (_, i) => new LogGroup(stack, `LG${i}`));

  new SavedQueriesConstruct(stack, "SQ", {
    allOrchestrationLogGroups: logGroups,
    taskFailureHandlerLogGroup: logGroups[5]!,
    orphanCleanupLogGroup: logGroups[7]!,
    ecsTaskLogGroup: logGroups[9]!,
  });

  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::Logs::QueryDefinition", 4);

  // Names use Fn::Join with AWS::StackName and AWS::Region pseudo-parameters
  // so each deployment gets a unique suffix at deploy time.
  const expectedNames = ["DLT - Test Timeline", "DLT - Test Errors", "DLT - Task Failures", "DLT - Orphan Cleanup"];
  for (const name of expectedNames) {
    template.hasResourceProperties("AWS::Logs::QueryDefinition", {
      Name: {
        "Fn::Join": Match.arrayWith([
          Match.exact(""),
          Match.arrayWith([Match.stringLikeRegexp(name)]),
        ]),
      },
    });
  }
});
