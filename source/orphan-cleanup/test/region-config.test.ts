// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAllRegionConfigs } from "../src/region-config.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
} as unknown as Logger;

beforeEach(() => {
  ddbMock.reset();
});

function makeDdb(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}));
}

describe("getAllRegionConfigs", () => {
  it("returns parsed region configs from DDB scan", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        {
          testId: "region-us-east-1",
          region: "us-east-1",
          taskCluster: "dlt-cluster-east",
          ecsCloudWatchLogGroup: "/ecs/dlt-east",
        },
        {
          testId: "region-us-west-2",
          region: "us-west-2",
          taskCluster: "dlt-cluster-west",
          ecsCloudWatchLogGroup: "/ecs/dlt-west",
        },
      ],
    });

    const result = await getAllRegionConfigs(makeDdb(), "test-table", logger);
    expect(result).toEqual([
      {
        testId: "region-us-east-1",
        region: "us-east-1",
        taskCluster: "dlt-cluster-east",
        ecsCloudWatchLogGroup: "/ecs/dlt-east",
      },
      {
        testId: "region-us-west-2",
        region: "us-west-2",
        taskCluster: "dlt-cluster-west",
        ecsCloudWatchLogGroup: "/ecs/dlt-west",
      },
    ]);
  });

  it("skips malformed entries", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { testId: "region-us-east-1", region: "us-east-1" }, // missing taskCluster
        {
          testId: "region-us-west-2",
          region: "us-west-2",
          taskCluster: "cluster",
          ecsCloudWatchLogGroup: "/ecs/log",
        },
      ],
    });

    const result = await getAllRegionConfigs(makeDdb(), "test-table", logger);
    expect(result).toHaveLength(1);
    expect(result[0]?.region).toBe("us-west-2");
  });

  it("returns empty array when no items", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const result = await getAllRegionConfigs(makeDdb(), "test-table", logger);
    expect(result).toEqual([]);
  });

  it("handles paginated scan results", async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: [
          {
            testId: "region-us-east-1",
            region: "us-east-1",
            taskCluster: "cluster-1",
            ecsCloudWatchLogGroup: "/ecs/1",
          },
        ],
        LastEvaluatedKey: { testId: { S: "region-us-east-1" } },
      })
      .resolvesOnce({
        Items: [
          {
            testId: "region-eu-west-1",
            region: "eu-west-1",
            taskCluster: "cluster-2",
            ecsCloudWatchLogGroup: "/ecs/2",
          },
        ],
      });

    const result = await getAllRegionConfigs(makeDdb(), "test-table", logger);
    expect(result).toHaveLength(2);
  });

  it("returns empty when Items is undefined", async () => {
    ddbMock.on(ScanCommand).resolves({});

    const result = await getAllRegionConfigs(makeDdb(), "test-table", logger);
    expect(result).toEqual([]);
  });

  it("propagates DDB errors", async () => {
    ddbMock.on(ScanCommand).rejects(new Error("DDB failure"));

    await expect(getAllRegionConfigs(makeDdb(), "test-table", logger)).rejects.toThrow("DDB failure");
  });
});
