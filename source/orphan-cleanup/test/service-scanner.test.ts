// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import { ECSClient, ListServicesCommand } from "@aws-sdk/client-ecs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findOrphans, listDltServices, parseDltServiceName } from "../src/service-scanner.js";

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

describe("parseDltServiceName", () => {
  it("extracts testId and region from a valid DLT service name", () => {
    const result = parseDltServiceName("dlt-abc123-def456-us-east-1");
    expect(result).toEqual({ testId: "abc123-def456", region: "us-east-1" });
  });

  it("handles multi-word regions", () => {
    const result = parseDltServiceName("dlt-test-id-ap-southeast-2");
    expect(result).toEqual({ testId: "test-id", region: "ap-southeast-2" });
  });

  it("returns undefined for non-DLT service names", () => {
    expect(parseDltServiceName("my-service")).toBeUndefined();
    expect(parseDltServiceName("")).toBeUndefined();
  });

  it("returns undefined for names without region suffix", () => {
    expect(parseDltServiceName("dlt-test-id")).toBeUndefined();
  });
});

describe("listDltServices", () => {
  it("returns discovered DLT services from cluster", async () => {
    ecsMock.on(ListServicesCommand).resolves({
      serviceArns: [
        "arn:aws:ecs:us-east-1:123:service/cluster/dlt-abc-us-east-1",
        "arn:aws:ecs:us-east-1:123:service/cluster/non-dlt-service",
      ],
    });

    const result = await listDltServices(new ECSClient({}), "cluster", logger);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      serviceArn: "arn:aws:ecs:us-east-1:123:service/cluster/dlt-abc-us-east-1",
      serviceName: "dlt-abc-us-east-1",
      testId: "abc",
      region: "us-east-1",
      cluster: "cluster",
    });
  });

  it("returns empty array when no services", async () => {
    ecsMock.on(ListServicesCommand).resolves({ serviceArns: [] });

    const result = await listDltServices(new ECSClient({}), "cluster", logger);
    expect(result).toEqual([]);
  });

  it("returns empty when serviceArns is undefined", async () => {
    ecsMock.on(ListServicesCommand).resolves({});

    const result = await listDltServices(new ECSClient({}), "cluster", logger);
    expect(result).toEqual([]);
  });

  it("skips ARNs that cannot be parsed into a service name", async () => {
    ecsMock.on(ListServicesCommand).resolves({
      serviceArns: ["arn-with-no-slashes"],
    });

    const result = await listDltServices(new ECSClient({}), "cluster", logger);
    expect(result).toEqual([]);
  });
});

describe("findOrphans", () => {
  const services = [
    { serviceArn: "arn:1", serviceName: "dlt-active-us-east-1", testId: "active", region: "us-east-1", cluster: "c" },
    {
      serviceArn: "arn:2",
      serviceName: "dlt-orphan-us-east-1",
      testId: "orphan",
      region: "us-east-1",
      cluster: "c",
    },
  ];

  it("returns services whose testId is not in active set", () => {
    const activeTestIds = new Set(["active"]);
    const result = findOrphans(services, activeTestIds);
    expect(result).toHaveLength(1);
    expect(result[0]?.testId).toBe("orphan");
  });

  it("returns empty when all services are active", () => {
    const activeTestIds = new Set(["active", "orphan"]);
    expect(findOrphans(services, activeTestIds)).toEqual([]);
  });

  it("returns all services when active set is empty", () => {
    expect(findOrphans(services, new Set())).toHaveLength(2);
  });

  it("returns empty when service list is empty", () => {
    expect(findOrphans([], new Set(["active"]))).toEqual([]);
  });
});
