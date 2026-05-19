// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

// Module mocks — must be before imports
vi.mock("@amzn/dlt-common", async () => {
  const actual = await vi.importActual<typeof import("@amzn/dlt-common")>("@amzn/dlt-common");
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      appendKeys: vi.fn(),
    }),
    getAwsClientConfig: (overrides?: Record<string, unknown>) => overrides ?? {},
    getRequiredEnv: (name: string) => `mock-${name}`,
  };
});

vi.mock("@aws-sdk/client-cloudwatch", () => ({ CloudWatchClient: vi.fn() }));
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: vi.fn() }));
vi.mock("@aws-sdk/client-ecs", () => ({ ECSClient: vi.fn() }));
vi.mock("@aws-sdk/client-sfn", () => ({ SFNClient: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({})) },
}));

const mockGetAllRegionConfigs = vi.fn();
const mockGetActiveTestIds = vi.fn();
const mockListDltServices = vi.fn();
const mockFindOrphans = vi.fn();
const mockCleanupOrphanedServices = vi.fn();
const mockPublishFailureCount = vi.fn();

vi.mock("../src/region-config.js", () => ({
  getAllRegionConfigs: (...args: unknown[]): unknown => mockGetAllRegionConfigs(...args),
}));

vi.mock("../src/execution-check.js", () => ({
  getActiveTestIds: (...args: unknown[]): unknown => mockGetActiveTestIds(...args),
}));

vi.mock("../src/service-scanner.js", () => ({
  listDltServices: (...args: unknown[]): unknown => mockListDltServices(...args),
  findOrphans: (...args: unknown[]): unknown => mockFindOrphans(...args),
}));

vi.mock("../src/service-cleanup.js", () => ({
  cleanupOrphanedServices: (...args: unknown[]): unknown => mockCleanupOrphanedServices(...args),
}));

vi.mock("../src/metrics.js", () => ({
  publishFailureCount: (...args: unknown[]): unknown => mockPublishFailureCount(...args),
}));

// Import handler after mocks are set up
const { handler } = await import("../src/index.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handler", () => {
  it("publishes 0 failures when no region configs found", async () => {
    mockGetAllRegionConfigs.mockResolvedValue([]);

    await handler();

    expect(mockPublishFailureCount).toHaveBeenCalledWith(expect.anything(), 0, expect.anything());
    expect(mockGetActiveTestIds).not.toHaveBeenCalled();
  });

  it("publishes 0 failures when no orphans found", async () => {
    mockGetAllRegionConfigs.mockResolvedValue([
      { testId: "region-us-east-1", region: "us-east-1", taskCluster: "cluster", ecsCloudWatchLogGroup: "/log" },
    ]);
    mockGetActiveTestIds.mockResolvedValue(new Set(["active-test"]));
    mockListDltServices.mockResolvedValue([]);
    mockFindOrphans.mockReturnValue([]);

    await handler();

    expect(mockPublishFailureCount).toHaveBeenCalledWith(expect.anything(), 0, expect.anything());
  });

  it("cleans up orphans and publishes failure count", async () => {
    const orphan = {
      serviceArn: "arn:1",
      serviceName: "dlt-test-us-east-1",
      testId: "test",
      region: "us-east-1",
      cluster: "cluster",
    };

    mockGetAllRegionConfigs.mockResolvedValue([
      { testId: "region-us-east-1", region: "us-east-1", taskCluster: "cluster", ecsCloudWatchLogGroup: "/log" },
    ]);
    mockGetActiveTestIds.mockResolvedValue(new Set());
    mockListDltServices.mockResolvedValue([orphan]);
    mockFindOrphans.mockReturnValue([orphan]);
    mockCleanupOrphanedServices.mockResolvedValue([{ serviceName: "dlt-test-us-east-1", success: true }]);

    await handler();

    expect(mockCleanupOrphanedServices).toHaveBeenCalled();
    expect(mockPublishFailureCount).toHaveBeenCalledWith(expect.anything(), 0, expect.anything());
  });

  it("publishes non-zero failure count when cleanup partially fails", async () => {
    const orphan = {
      serviceArn: "arn:1",
      serviceName: "dlt-test-us-east-1",
      testId: "test",
      region: "us-east-1",
      cluster: "cluster",
    };

    mockGetAllRegionConfigs.mockResolvedValue([
      { testId: "region-us-east-1", region: "us-east-1", taskCluster: "cluster", ecsCloudWatchLogGroup: "/log" },
    ]);
    mockGetActiveTestIds.mockResolvedValue(new Set());
    mockListDltServices.mockResolvedValue([orphan]);
    mockFindOrphans.mockReturnValue([orphan]);
    mockCleanupOrphanedServices.mockResolvedValue([
      { serviceName: "dlt-test-us-east-1", success: false, error: "throttled" },
    ]);

    await handler();

    expect(mockPublishFailureCount).toHaveBeenCalledWith(expect.anything(), 1, expect.anything());
  });

  it("publishes failure metric and re-throws on handler-level error", async () => {
    mockGetAllRegionConfigs.mockRejectedValue(new Error("DDB scan failed"));

    await expect(handler()).rejects.toThrow("DDB scan failed");
    expect(mockPublishFailureCount).toHaveBeenCalledWith(expect.anything(), 1, expect.anything());
  });

  it("publishes orphan count as failure value on handler error after discovery", async () => {
    mockGetAllRegionConfigs.mockResolvedValue([
      { testId: "region-us-east-1", region: "us-east-1", taskCluster: "cluster", ecsCloudWatchLogGroup: "/log" },
    ]);
    mockGetActiveTestIds.mockResolvedValue(new Set());
    mockListDltServices.mockResolvedValue([
      { serviceArn: "a:1", serviceName: "dlt-a-us-east-1", testId: "a", region: "us-east-1", cluster: "cluster" },
      { serviceArn: "a:2", serviceName: "dlt-b-us-east-1", testId: "b", region: "us-east-1", cluster: "cluster" },
    ]);
    mockFindOrphans.mockReturnValue([
      { serviceArn: "a:1", serviceName: "dlt-a-us-east-1", testId: "a", region: "us-east-1", cluster: "cluster" },
      { serviceArn: "a:2", serviceName: "dlt-b-us-east-1", testId: "b", region: "us-east-1", cluster: "cluster" },
    ]);
    mockCleanupOrphanedServices.mockRejectedValue(new Error("cleanup boom"));

    await expect(handler()).rejects.toThrow("cleanup boom");
    // Should publish 2 (the number of detected orphans) since cleanup failed entirely
    expect(mockPublishFailureCount).toHaveBeenCalledWith(expect.anything(), 2, expect.anything());
  });

  it("groups orphans by region for cleanup", async () => {
    const orphanEast = {
      serviceArn: "arn:1",
      serviceName: "dlt-test-us-east-1",
      testId: "test",
      region: "us-east-1",
      cluster: "cluster-east",
    };
    const orphanWest = {
      serviceArn: "arn:2",
      serviceName: "dlt-test-us-west-2",
      testId: "test",
      region: "us-west-2",
      cluster: "cluster-west",
    };

    mockGetAllRegionConfigs.mockResolvedValue([
      { testId: "region-us-east-1", region: "us-east-1", taskCluster: "cluster-east", ecsCloudWatchLogGroup: "/e" },
      { testId: "region-us-west-2", region: "us-west-2", taskCluster: "cluster-west", ecsCloudWatchLogGroup: "/w" },
    ]);
    mockGetActiveTestIds.mockResolvedValue(new Set());
    mockListDltServices.mockResolvedValueOnce([orphanEast]).mockResolvedValueOnce([orphanWest]);
    mockFindOrphans.mockReturnValueOnce([orphanEast]).mockReturnValueOnce([orphanWest]);
    mockCleanupOrphanedServices.mockResolvedValue([{ success: true }]);

    await handler();

    // cleanupOrphanedServices called twice — once per region
    expect(mockCleanupOrphanedServices).toHaveBeenCalledTimes(2);
  });
});
