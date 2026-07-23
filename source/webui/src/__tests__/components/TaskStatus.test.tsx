// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { computeTaskStatusItem } from "../../pages/scenarios/components/TaskStatus";

describe("computeTaskStatusItem", () => {
  const baseTasks = { region: "us-east-1", running: 0, pending: 0, desired: 10 };
  const baseConfig = { region: "us-east-1", taskCount: 10, concurrency: 100 };

  it("returns Ready when running equals desired", () => {
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 10, pending: 0 },
      baseConfig,
      "running",
      0
    );
    expect(result.regionStatus).toBe("Ready");
    expect(result.running).toBe(10);
    expect(result.desired).toBe(10);
    expect(result.provisioning).toBe(0);
    expect(result.stopped).toBe(0);
  });

  it("returns Provisioning when running < desired with no stopped", () => {
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 3, pending: 2 },
      baseConfig,
      "provisioning",
      0
    );
    expect(result.regionStatus).toBe("Provisioning");
    expect(result.provisioning).toBe(5); // 10 - 3 - 2 - 0
  });

  it("returns Degraded when stopped > 0 during running state", () => {
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 7, pending: 0 },
      baseConfig,
      "running",
      3
    );
    expect(result.regionStatus).toBe("Degraded");
    expect(result.stopped).toBe(3);
    expect(result.provisioning).toBe(0); // 10 - 7 - 0 - 3 = 0
  });

  it("returns Stopping when stopped > 0 during cancelling state", () => {
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 5, pending: 0 },
      baseConfig,
      "cancelling",
      5
    );
    expect(result.regionStatus).toBe("Stopping");
    expect(result.stopped).toBe(5);
  });

  it("returns Stopping when stopped > 0 during cleaning up state", () => {
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 2, pending: 0 },
      baseConfig,
      "cleaning up",
      8
    );
    expect(result.regionStatus).toBe("Stopping");
  });

  it("handles zero desired from missing testTaskConfig", () => {
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 0, pending: 0 },
      undefined,
      "provisioning",
      0
    );
    expect(result.desired).toBe(0);
    expect(result.concurrency).toBe(0);
    expect(result.provisioning).toBe(0);
  });

  it("clamps provisioning to 0 when sum exceeds desired", () => {
    // If running + pending + stopped > desired, provisioning should be 0
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 8, pending: 3 },
      baseConfig,
      "running",
      2
    );
    expect(result.provisioning).toBe(0); // max(0, 10 - 8 - 3 - 2) = max(0, -3) = 0
  });

  it("correctly assigns region from tasksPerRegion", () => {
    const result = computeTaskStatusItem(
      { region: "eu-west-1", running: 5, pending: 0, desired: 5 },
      { region: "eu-west-1", taskCount: 5, concurrency: 50 },
      "running",
      0
    );
    expect(result.region).toBe("eu-west-1");
    expect(result.concurrency).toBe(50);
  });

  it("uses default 0 for taskFailureCount when not provided", () => {
    const result = computeTaskStatusItem(
      { ...baseTasks, running: 5, pending: 5 },
      baseConfig,
      "provisioning"
    );
    expect(result.stopped).toBe(0);
    expect(result.provisioning).toBe(0);
  });
});
