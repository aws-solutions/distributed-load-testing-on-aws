// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  DeleteTaskDefinitionsCommand,
  DeregisterTaskDefinitionCommand,
  ECSClient,
  ListTaskDefinitionsCommand,
  SortOrder,
  TaskDefinitionStatus,
} from "@aws-sdk/client-ecs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupTaskDefinitions } from "../src/task-definition-cleanup.js";

const ecsMock = mockClient(ECSClient);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendKeys: vi.fn(),
  };
}

function makeParams() {
  return {
    ecs: new ECSClient({}),
    family: "dlt-worker-test-abc123",
    logger: makeLogger() as never,
  };
}

/** Generates ARNs like `...:N` for revisions 1..count */
function makeArns(family: string, count: number, startAt = 1): string[] {
  return Array.from(
    { length: count },
    (_, i) => `arn:aws:ecs:us-east-1:123456789:task-definition/${family}:${startAt + i}`
  );
}

describe("cleanupTaskDefinitions", () => {
  beforeEach(() => {
    ecsMock.reset();
  });

  it("should discover active revisions, deregister them, and delete old inactive revisions while retaining 3", async () => {
    const activeArns = makeArns("dlt-worker-test-abc123", 1, 5);
    const inactiveArns = makeArns("dlt-worker-test-abc123", 5);

    // First ListTaskDefinitions call: ACTIVE
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: activeArns });
    // Second ListTaskDefinitions call: INACTIVE
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: inactiveArns });
    ecsMock.on(DeregisterTaskDefinitionCommand).resolves({});
    ecsMock.on(DeleteTaskDefinitionsCommand).resolves({});

    await cleanupTaskDefinitions(makeParams());

    // Deregister called once (for the one active revision)
    expect(ecsMock.commandCalls(DeregisterTaskDefinitionCommand)).toHaveLength(1);
    expect(ecsMock.commandCalls(DeregisterTaskDefinitionCommand)[0]?.args[0].input.taskDefinition).toBe(activeArns[0]);

    // List INACTIVE uses ASC sort
    const inactiveListCall = ecsMock
      .commandCalls(ListTaskDefinitionsCommand)
      .find((call) => call.args[0].input.status === TaskDefinitionStatus.INACTIVE);
    expect(inactiveListCall?.args[0].input).toMatchObject({
      familyPrefix: "dlt-worker-test-abc123",
      status: TaskDefinitionStatus.INACTIVE,
      sort: SortOrder.ASC,
    });

    // 5 inactive - 3 retained = 2 deleted (revisions 1 and 2)
    const deleteCall = ecsMock.commandCalls(DeleteTaskDefinitionsCommand)[0];
    expect(deleteCall?.args[0].input.taskDefinitions).toEqual(inactiveArns.slice(0, 2));
  });

  it("should handle multiple active revisions", async () => {
    const activeArns = makeArns("dlt-worker-test-abc123", 3, 4);

    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: activeArns });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: [] });
    ecsMock.on(DeregisterTaskDefinitionCommand).resolves({});

    await cleanupTaskDefinitions(makeParams());

    // All 3 active revisions deregistered
    expect(ecsMock.commandCalls(DeregisterTaskDefinitionCommand)).toHaveLength(3);
  });

  it("should skip deregistration when no active revisions exist", async () => {
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: [] });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 2) });

    await cleanupTaskDefinitions(makeParams());

    expect(ecsMock.commandCalls(DeregisterTaskDefinitionCommand)).toHaveLength(0);
    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(0);
  });

  it("should not delete anything when inactive count is at or below retention threshold", async () => {
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 1, 4) });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 3) });
    ecsMock.on(DeregisterTaskDefinitionCommand).resolves({});

    await cleanupTaskDefinitions(makeParams());

    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(0);
  });

  it("should not delete anything when no inactive revisions exist", async () => {
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: [] });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: [] });

    await cleanupTaskDefinitions(makeParams());

    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(0);
  });

  it("should handle paginated inactive list responses", async () => {
    const page1 = makeArns("dlt-worker-test-abc123", 10);
    const page2 = makeArns("dlt-worker-test-abc123", 5, 11);

    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: [] });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolvesOnce({ taskDefinitionArns: page1, nextToken: "token1" })
      .resolvesOnce({ taskDefinitionArns: page2 });
    ecsMock.on(DeleteTaskDefinitionsCommand).resolves({});

    await cleanupTaskDefinitions(makeParams());

    // 15 total - 3 retained = 12 to delete, in batches of 10
    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(2);
    const batch1 = ecsMock.commandCalls(DeleteTaskDefinitionsCommand)[0]?.args[0].input.taskDefinitions;
    const batch2 = ecsMock.commandCalls(DeleteTaskDefinitionsCommand)[1]?.args[0].input.taskDefinitions;
    expect(batch1).toHaveLength(10);
    expect(batch2).toHaveLength(2);
  });

  it("should continue cleanup even if deregistering an active revision fails", async () => {
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 1, 5) });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 5) });
    ecsMock.on(DeregisterTaskDefinitionCommand).rejects(new Error("Access denied"));
    ecsMock.on(DeleteTaskDefinitionsCommand).resolves({});

    // Should not throw
    await cleanupTaskDefinitions(makeParams());

    // Still attempted delete of old inactive revisions
    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(1);
  });

  it("should continue cleanup if listing active revisions fails", async () => {
    ecsMock.on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE }).rejects(new Error("Throttled"));
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 5) });
    ecsMock.on(DeleteTaskDefinitionsCommand).resolves({});

    // Should not throw — deregister is skipped, but inactive cleanup proceeds
    await cleanupTaskDefinitions(makeParams());

    expect(ecsMock.commandCalls(DeregisterTaskDefinitionCommand)).toHaveLength(0);
    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(1);
  });

  it("should return early if listing inactive revisions fails", async () => {
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: [] });
    ecsMock.on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE }).rejects(new Error("Throttled"));

    // Should not throw
    await cleanupTaskDefinitions(makeParams());

    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(0);
  });

  it("should continue with remaining batches if one batch delete fails", async () => {
    // 14 inactive → 11 to delete → 2 batches (10 + 1)
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: [] });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 14) });
    ecsMock.on(DeleteTaskDefinitionsCommand).rejectsOnce(new Error("Batch 0 failed")).resolves({});

    // Should not throw
    await cleanupTaskDefinitions(makeParams());

    // Both batches attempted
    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(2);
  });

  it("should handle single inactive revision (below retention) without deleting", async () => {
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.ACTIVE })
      .resolves({ taskDefinitionArns: [] });
    ecsMock
      .on(ListTaskDefinitionsCommand, { status: TaskDefinitionStatus.INACTIVE })
      .resolves({ taskDefinitionArns: makeArns("dlt-worker-test-abc123", 1) });

    await cleanupTaskDefinitions(makeParams());

    expect(ecsMock.commandCalls(DeleteTaskDefinitionsCommand)).toHaveLength(0);
  });
});
