// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import type { ECSTaskStateChangeEvent } from "../src/event-parser.js";
import { extractTaskFailure } from "../src/event-parser.js";

/** Helper to build a valid ECS Task State Change event */
function makeEvent(overrides: Partial<ECSTaskStateChangeEvent["detail"]> = {}): ECSTaskStateChangeEvent {
  return {
    detail: {
      lastStatus: "STOPPED",
      group: "service:dlt-abc123-def456-us-east-1",
      clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster",
      taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test-cluster/task-id",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      containers: [{ exitCode: 1 }],
      ...overrides,
    },
  };
}

describe("extractTaskFailure", () => {
  it("extracts testId and region from a valid DLT service event", () => {
    const result = extractTaskFailure(makeEvent());

    expect(result).toEqual({
      testId: "abc123-def456",
      region: "us-east-1",
      taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test-cluster/task-id",
      clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster",
      stoppedReason: "Essential container exited",
      stopCode: "EssentialContainerExited",
      exitCode: 1,
    });
  });

  it("handles multi-word regions like ap-southeast-2", () => {
    const result = extractTaskFailure(makeEvent({ group: "service:dlt-test-id-123-ap-southeast-2" }));

    expect(result).toBeDefined();
    expect(result?.testId).toBe("test-id-123");
    expect(result?.region).toBe("ap-southeast-2");
  });

  it("returns undefined for non-DLT service groups", () => {
    expect(extractTaskFailure(makeEvent({ group: "service:my-other-service" }))).toBeUndefined();
  });

  it("returns undefined for standalone tasks (group without service: prefix)", () => {
    expect(extractTaskFailure(makeEvent({ group: "family:my-task-def" }))).toBeUndefined();
  });

  it("returns undefined when all containers exited with code 0 (graceful shutdown)", () => {
    const event = makeEvent({
      containers: [{ exitCode: 0 }, { exitCode: 0 }],
    });
    expect(extractTaskFailure(event)).toBeUndefined();
  });

  it("returns undefined when all containers exited with code 143 (SIGTERM graceful shutdown)", () => {
    const event = makeEvent({
      containers: [{ exitCode: 143 }],
    });
    expect(extractTaskFailure(event)).toBeUndefined();
  });

  it("returns undefined when containers exited with mix of 0 and 143 (both graceful)", () => {
    const event = makeEvent({
      containers: [{ exitCode: 0 }, { exitCode: 143 }],
    });
    expect(extractTaskFailure(event)).toBeUndefined();
  });

  it("returns a failure when at least one container has a non-zero exit code", () => {
    const event = makeEvent({
      containers: [{ exitCode: 0 }, { exitCode: 137 }],
    });
    expect(extractTaskFailure(event)).toBeDefined();
  });

  it("returns a failure when containers have no exit code (killed before exit)", () => {
    const event = makeEvent({
      containers: [{}],
    });
    expect(extractTaskFailure(event)).toBeDefined();
  });

  it("returns a failure for empty containers array", () => {
    const event = makeEvent({ containers: [] });
    expect(extractTaskFailure(event)).toBeDefined();
  });

  it("defaults stoppedReason and stopCode to 'Unknown' when absent", () => {
    const event: ECSTaskStateChangeEvent = {
      detail: {
        lastStatus: "STOPPED",
        group: "service:dlt-abc123-us-east-1",
        clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster",
        taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test-cluster/task-id",
        containers: [{ exitCode: 1 }],
      },
    };
    const result = extractTaskFailure(event);

    expect(result?.stoppedReason).toBe("Unknown");
    expect(result?.stopCode).toBe("Unknown");
  });
});
