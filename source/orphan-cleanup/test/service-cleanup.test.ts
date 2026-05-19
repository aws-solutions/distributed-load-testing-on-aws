// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import {
  DeleteServiceCommand,
  ECSClient,
  ServiceNotActiveException,
  ServiceNotFoundException,
  UpdateServiceCommand,
} from "@aws-sdk/client-ecs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupOrphanedServices } from "../src/service-cleanup.js";
import type { DiscoveredService } from "../src/service-scanner.js";

const ecsMock = mockClient(ECSClient);

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
} as unknown as Logger;

beforeEach(() => {
  ecsMock.reset();
});

const orphan: DiscoveredService = {
  serviceArn: "arn:aws:ecs:us-east-1:123:service/cluster/dlt-test-us-east-1",
  serviceName: "dlt-test-us-east-1",
  testId: "test",
  region: "us-east-1",
  cluster: "cluster",
};

describe("cleanupOrphanedServices", () => {
  it("successfully scales down and force-deletes an orphaned service", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});

    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.serviceName).toBe("dlt-test-us-east-1");
  });

  it("handles ServiceNotFoundException on scale-down as success", async () => {
    ecsMock.on(UpdateServiceCommand).rejects(new ServiceNotFoundException({ message: "not found", $metadata: {} }));

    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    expect(results[0]?.success).toBe(true);
  });

  it("handles ServiceNotActiveException on scale-down as success", async () => {
    ecsMock.on(UpdateServiceCommand).rejects(new ServiceNotActiveException({ message: "not active", $metadata: {} }));

    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    expect(results[0]?.success).toBe(true);
  });

  it("handles ServiceNotFoundException on delete as success", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).rejects(new ServiceNotFoundException({ message: "not found", $metadata: {} }));

    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    expect(results[0]?.success).toBe(true);
  });

  it("records failure when scale-down throws unexpected error", async () => {
    ecsMock.on(UpdateServiceCommand).rejects(new Error("throttled"));

    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toBe("throttled");
  });

  it("records failure when delete throws unexpected error", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).rejects(new Error("access denied"));

    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toBe("access denied");
  });

  it("continues processing remaining services after one failure", async () => {
    const orphan2: DiscoveredService = {
      ...orphan,
      serviceName: "dlt-test2-us-east-1",
      testId: "test2",
    };

    ecsMock.on(UpdateServiceCommand, { service: "dlt-test-us-east-1" }).rejects(new Error("fail-first"));
    ecsMock.on(UpdateServiceCommand, { service: "dlt-test2-us-east-1" }).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});

    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan, orphan2],
      logger,
      gracePeriodMs: 0,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.success).toBe(false);
    expect(results[1]?.success).toBe(true);
  });

  it("returns empty results for empty orphan list", async () => {
    const results = await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [],
      logger,
      gracePeriodMs: 0,
    });

    expect(results).toEqual([]);
  });

  it("uses force: true on delete command", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});

    await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    const deleteCall = ecsMock.commandCalls(DeleteServiceCommand)[0];
    expect(deleteCall?.args[0].input.force).toBe(true);
  });

  it("sets desiredCount to 0 on update command", async () => {
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});

    await cleanupOrphanedServices({
      ecs: new ECSClient({}),
      orphans: [orphan],
      logger,
      gracePeriodMs: 0,
    });

    const updateCall = ecsMock.commandCalls(UpdateServiceCommand)[0];
    expect(updateCall?.args[0].input.desiredCount).toBe(0);
  });
});
