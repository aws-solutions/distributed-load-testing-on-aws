// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ServiceStabilizationResult } from "@amzn/dlt-common";
import { StabilizationStatus } from "@amzn/dlt-common";
import { describe, expect, it } from "vitest";

import { validateRegions } from "../src/sync.js";

function makeRegion(
  region: string,
  status: StabilizationStatus,
  readyTimestamp = 0,
  overrides: Partial<ServiceStabilizationResult> = {}
): ServiceStabilizationResult {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    testType: "simple",
    fileType: "none",
    showLive: true,
    testDuration: 300,
    prefix: "2025-01-01T00-00-00_abc",
    testTaskConfig: {
      region,
      taskCluster: `dlt-cluster-${region}`,
      taskCount: 5,
      subnetA: "subnet-aaa",
      subnetB: "subnet-bbb",
      taskSecurityGroup: "sg-123",
      ecsCloudWatchLogGroup: "/ecs/dlt-load-tester",
      taskRoleArn: `arn:aws:iam::123456789:role/dlt-task-role-${region}`,
      executionRoleArn: `arn:aws:iam::123456789:role/dlt-execution-role-${region}`,
    },
    status,
    stabilizationStartTime: 1000000,
    serviceName: `dlt-test-abc123-${region}`,
    serviceArn: `arn:aws:ecs:${region}:123456789:service/dlt-cluster/dlt-test-abc123-${region}`,
    taskDefinitionArn: `arn:aws:ecs:${region}:123456789:task-definition/dlt-worker-test-abc123:1`,
    taskDefinitionFamily: "dlt-worker-test-abc123",
    desiredCount: 5,
    runningCount: status === StabilizationStatus.READY ? 5 : 0,
    readyTimestamp,
    ...overrides,
  };
}

describe("validateRegions", () => {
  it("should return allReady: true when all regions are READY", () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.READY, 2000),
    ];

    const result = validateRegions(regions);

    expect(result.allReady).toBe(true);
    expect(result.regions).toHaveLength(2);
    expect(result.failedRegions).toBeUndefined();
  });

  it("should return allReady: false when one region FAILED", () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.FAILED),
      makeRegion("ap-southeast-2", StabilizationStatus.READY, 3000),
    ];

    const result = validateRegions(regions);

    expect(result.allReady).toBe(false);
    expect(result.failedRegions).toEqual(["eu-west-1"]);
  });

  it("should return allReady: false when all regions FAILED", () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.FAILED),
      makeRegion("eu-west-1", StabilizationStatus.FAILED),
    ];

    const result = validateRegions(regions);

    expect(result.allReady).toBe(false);
    expect(result.syncDelay).toBe(0);
    expect(result.failedRegions).toEqual(["us-east-1", "eu-west-1"]);
  });

  it("should return syncDelay: 0 for a single READY region", () => {
    const regions = [makeRegion("us-east-1", StabilizationStatus.READY, 5000)];

    const result = validateRegions(regions);

    expect(result.allReady).toBe(true);
    expect(result.syncDelay).toBe(0);
  });

  it("should compute syncDelay as max - min of readyTimestamps", () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.READY, 3000),
      makeRegion("ap-southeast-2", StabilizationStatus.READY, 2000),
    ];

    const result = validateRegions(regions);

    expect(result.syncDelay).toBe(2000);
  });

  it("should compute syncDelay only from READY regions when mixed with FAILED", () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.FAILED),
      makeRegion("ap-southeast-2", StabilizationStatus.READY, 4000),
    ];

    const result = validateRegions(regions);

    expect(result.allReady).toBe(false);
    expect(result.syncDelay).toBe(3000);
  });

  it("should return allReady: false when a region has PENDING status", () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.PENDING),
    ];

    const result = validateRegions(regions);

    expect(result.allReady).toBe(false);
    expect(result.failedRegions).toEqual(["eu-west-1"]);
  });

  it("should throw when regions array is empty", () => {
    expect(() => validateRegions([])).toThrow("No regions provided");
  });

  it("should include all regions in the output", () => {
    const regions = [
      makeRegion("us-east-1", StabilizationStatus.READY, 1000),
      makeRegion("eu-west-1", StabilizationStatus.READY, 2000),
    ];

    const result = validateRegions(regions);

    expect(result.regions).toHaveLength(2);
    expect(result.regions[0]?.testTaskConfig.region).toBe("us-east-1");
    expect(result.regions[1]?.testTaskConfig.region).toBe("eu-west-1");
  });
});
