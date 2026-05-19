// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TestExecutionInput } from "@amzn/dlt-common";
import { describe, expect, it } from "vitest";

import { TestStatus } from "@amzn/dlt-common";

import { buildCleanupEvents, parseExecutionInput } from "../src/execution-parser.js";

function makeValidInput(): string {
  return JSON.stringify({
    testId: "test-abc123",
    testRunId: "run-001",
    testTaskConfig: [
      {
        region: "us-east-1",
        taskCluster: "dlt-cluster",
        taskCount: 10,
        subnetA: "subnet-aaa",
        subnetB: "subnet-bbb",
        taskSecurityGroup: "sg-123",
        ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
        taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role",
        executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role",
      },
    ],
    testType: "jmeter",
    fileType: "jmx",
    showLive: true,
    testDuration: 300,
    prefix: "prefix-1",
    hubTaskDefinition: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
  });
}

describe("parseExecutionInput", () => {
  it("should parse valid JSON into TestExecutionInput", () => {
    const result = parseExecutionInput(makeValidInput());

    expect(result.testId).toBe("test-abc123");
    expect(result.testRunId).toBe("run-001");
    expect(result.testTaskConfig).toHaveLength(1);
    expect(result.testTaskConfig[0]?.region).toBe("us-east-1");
  });

  it("should throw on malformed JSON", () => {
    expect(() => parseExecutionInput("not valid json {{{")).toThrow();
  });

  it("should throw when testId is missing", () => {
    expect(() => parseExecutionInput('{"testTaskConfig": [{"region":"us-east-1"}]}')).toThrow(
      "missing testId or testTaskConfig"
    );
  });

  it("should throw when testTaskConfig is missing", () => {
    expect(() => parseExecutionInput('{"testId":"test-123"}')).toThrow();
  });

  it("should throw when testTaskConfig is empty", () => {
    expect(() => parseExecutionInput('{"testId":"test-123","testTaskConfig":[]}')).toThrow(
      "missing testId or testTaskConfig"
    );
  });
});

describe("buildCleanupEvents", () => {
  it("should build one TestCleanupEvent per region with finalStatus FAILED", () => {
    const input = parseExecutionInput(makeValidInput());
    const events = buildCleanupEvents(input);

    expect(events).toHaveLength(1);
    expect(events[0]?.finalStatus).toBe(TestStatus.FAILED);
    expect(events[0]?.errorReason).toBe("Step function execution failed");
  });

  it("should build events for multi-region input", () => {
    const input: TestExecutionInput = {
      testId: "test-multi",
      testRunId: "run-002",
      testTaskConfig: [
        {
          region: "us-east-1",
          taskCluster: "cluster-east",
          taskCount: 100,
          subnetA: "subnet-a1",
          subnetB: "subnet-b1",
          taskSecurityGroup: "sg-1",
          ecsCloudWatchLogGroup: "/ecs/log1",
          taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role-east",
          executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role-east",
        },
        {
          region: "eu-west-1",
          taskCluster: "cluster-eu",
          taskCount: 50,
          subnetA: "subnet-a2",
          subnetB: "subnet-b2",
          taskSecurityGroup: "sg-2",
          ecsCloudWatchLogGroup: "/ecs/log2",
          taskRoleArn: "arn:aws:iam::123456789:role/dlt-task-role-eu",
          executionRoleArn: "arn:aws:iam::123456789:role/dlt-execution-role-eu",
        },
      ],
      testType: "jmeter",
      fileType: "jmx",
      showLive: false,
      testDuration: 600,
      prefix: "prefix-2",
      hubTaskDefinition: "arn:aws:ecs:us-east-1:123456789:task-definition/dlt-base:1",
    };

    const events = buildCleanupEvents(input);

    expect(events).toHaveLength(2);
    expect(events[0]?.testTaskConfig.region).toBe("us-east-1");
    expect(events[1]?.testTaskConfig.region).toBe("eu-west-1");
  });

  it("should pass through testId and testRunId", () => {
    const input = parseExecutionInput(makeValidInput());
    const events = buildCleanupEvents(input);

    expect(events[0]?.testId).toBe("test-abc123");
    expect(events[0]?.testRunId).toBe("run-001");
  });

  it("should pass through the region config", () => {
    const input = parseExecutionInput(makeValidInput());
    const events = buildCleanupEvents(input);

    expect(events[0]?.testTaskConfig.region).toBe("us-east-1");
    expect(events[0]?.testTaskConfig.taskCluster).toBe("dlt-cluster");
  });
});
