// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  AccessDeniedException,
  DeleteServiceCommand,
  DescribeServicesCommand,
  ECSClient,
  ServiceNotActiveException,
  ServiceNotFoundException,
  UpdateServiceCommand,
} from "@aws-sdk/client-ecs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DrainAndDeleteServiceParams } from "../src/service-cleanup.js";
import { drainAndDeleteService } from "../src/service-cleanup.js";

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

function makeParams(overrides?: Partial<DrainAndDeleteServiceParams>): DrainAndDeleteServiceParams {
  return {
    ecs: new ECSClient({}),
    cluster: "dlt-cluster",
    serviceName: "dlt-test123-us-east-1",
    logger: makeLogger() as never,
    // Zero sleep timings — tests run instantly with no fake timers needed.
    // maxDrainWaitMs is generous so the polling loop can execute; with
    // drainPollIntervalMs: 0 and mocked SDK responses the loop completes
    // in microseconds.
    initialGracePeriodMs: 0,
    drainPollIntervalMs: 0,
    maxDrainWaitMs: 60_000,
    ...overrides,
  };
}

describe("drainAndDeleteService", () => {
  beforeEach(() => {
    ecsMock.reset();
  });

  it("should scale to zero, wait, then delete when service drains immediately", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ runningCount: 0 }],
    });
    ecsMock.on(DeleteServiceCommand).resolves({});

    await drainAndDeleteService(makeParams());

    expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(1);
    expect(ecsMock.commandCalls(UpdateServiceCommand)[0]?.args[0].input).toMatchObject({
      desiredCount: 0,
    });
    // Drained → no force flag
    expect(ecsMock.commandCalls(DeleteServiceCommand)).toHaveLength(1);
    expect(ecsMock.commandCalls(DeleteServiceCommand)[0]?.args[0].input).not.toHaveProperty("force");
  });

  it("should poll and wait for drain before deleting", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock
      .on(DescribeServicesCommand)
      .resolvesOnce({ services: [{ runningCount: 5 }] }) // pre-check
      .resolvesOnce({ services: [{ runningCount: 5 }] })
      .resolvesOnce({ services: [{ runningCount: 2 }] })
      .resolvesOnce({ services: [{ runningCount: 0 }] });
    ecsMock.on(DeleteServiceCommand).resolves({});

    await drainAndDeleteService(makeParams({ maxDrainWaitMs: 60_000 }));

    expect(ecsMock.commandCalls(DescribeServicesCommand)).toHaveLength(4);
    // Drained → no force
    expect(ecsMock.commandCalls(DeleteServiceCommand)[0]?.args[0].input).not.toHaveProperty("force");
  });

  it("should force-delete when service does not drain within timeout", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    // Always returns running tasks — never drains
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ runningCount: 3 }],
    });
    ecsMock.on(DeleteServiceCommand).resolves({});

    // maxDrainWaitMs: 0 means the deadline is immediately passed → force delete
    await drainAndDeleteService(makeParams({ maxDrainWaitMs: 0 }));

    // Should have force: true since it timed out
    const deleteCall = ecsMock.commandCalls(DeleteServiceCommand)[0];
    expect(deleteCall?.args[0].input).toMatchObject({ force: true });
  });

  it("should return early if service does not exist", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({ services: [] });

    await drainAndDeleteService(makeParams());

    expect(ecsMock.commandCalls(DescribeServicesCommand)).toHaveLength(1);
    expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0);
    expect(ecsMock.commandCalls(DeleteServiceCommand)).toHaveLength(0);
  });

  it("should return early if pre-check gets AccessDeniedException (non-existent service with tag-based IAM)", async () => {
    ecsMock.on(DescribeServicesCommand).rejects(new AccessDeniedException({ message: "not authorized", $metadata: {} }));

    await drainAndDeleteService(makeParams());

    expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0);
    expect(ecsMock.commandCalls(DeleteServiceCommand)).toHaveLength(0);
  });

  it("should return immediately if updateService throws ServiceNotFoundException", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ runningCount: 1 }] });
    ecsMock.on(UpdateServiceCommand).rejects(new ServiceNotFoundException({ message: "not found", $metadata: {} }));

    await drainAndDeleteService(makeParams());

    expect(ecsMock.commandCalls(DeleteServiceCommand)).toHaveLength(0);
  });

  it("should return immediately if updateService throws ServiceNotActiveException", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ runningCount: 1 }] });
    ecsMock.on(UpdateServiceCommand).rejects(new ServiceNotActiveException({ message: "not active", $metadata: {} }));

    await drainAndDeleteService(makeParams());

    expect(ecsMock.commandCalls(DeleteServiceCommand)).toHaveLength(0);
  });

  it("should handle ServiceNotFoundException during drain poll gracefully", async () => {
    ecsMock
      .on(DescribeServicesCommand)
      .resolvesOnce({ services: [{ runningCount: 1 }] }) // pre-check: exists
      .rejects(new ServiceNotFoundException({ message: "gone", $metadata: {} })); // drain poll
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});

    await drainAndDeleteService(makeParams({ maxDrainWaitMs: 60_000 }));

    // Treated as drained → no force
    expect(ecsMock.commandCalls(DeleteServiceCommand)[0]?.args[0].input).not.toHaveProperty("force");
  });

  it("should treat empty services array in describe poll as drained", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock
      .on(DescribeServicesCommand)
      .resolvesOnce({ services: [{ runningCount: 1 }] }) // pre-check: exists
      .resolves({ services: [] }); // drain poll: disappeared
    ecsMock.on(DeleteServiceCommand).resolves({});

    await drainAndDeleteService(makeParams({ maxDrainWaitMs: 60_000 }));

    expect(ecsMock.commandCalls(DeleteServiceCommand)).toHaveLength(1);
    expect(ecsMock.commandCalls(DeleteServiceCommand)[0]?.args[0].input).not.toHaveProperty("force");
  });

  it("should handle ServiceNotFoundException during delete gracefully", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ runningCount: 0 }] });
    ecsMock.on(DeleteServiceCommand).rejects(new ServiceNotFoundException({ message: "already gone", $metadata: {} }));

    // Should not throw
    await drainAndDeleteService(makeParams({ maxDrainWaitMs: 60_000 }));
  });

  it("should propagate unexpected errors from updateService", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ runningCount: 1 }] });
    ecsMock.on(UpdateServiceCommand).rejects(new Error("Access denied"));

    await expect(drainAndDeleteService(makeParams())).rejects.toThrow("Access denied");
  });

  it("should propagate unexpected errors from describeServices during poll", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock
      .on(DescribeServicesCommand)
      .resolvesOnce({ services: [{ runningCount: 1 }] }) // pre-check: exists
      .rejects(new Error("Throttled")); // drain poll

    await expect(drainAndDeleteService(makeParams({ maxDrainWaitMs: 60_000 }))).rejects.toThrow("Throttled");
  });

  it("should propagate unexpected errors from deleteService", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ runningCount: 0 }] });
    ecsMock.on(DeleteServiceCommand).rejects(new Error("Internal failure"));

    await expect(drainAndDeleteService(makeParams({ maxDrainWaitMs: 60_000 }))).rejects.toThrow("Internal failure");
  });
});
