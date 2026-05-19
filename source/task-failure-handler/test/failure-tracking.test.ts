// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, describe, expect, it, vi } from "vitest";

import { incrementFailureCount, isThresholdBreached } from "../src/failure-tracking.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
  addContext: vi.fn(),
};

afterEach(() => {
  ddbMock.reset();
  vi.clearAllMocks();
});

describe("incrementFailureCount", () => {
  it("increments counter and returns scenario fields", async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        taskFailureCount: 3,
        desiredTaskCount: 10,
        healthyThreshold: 90,
        status: "running",
        testRunId: "run-123",
      },
    });

    const result = await incrementFailureCount({
      ddb,
      tableName: "scenarios",
      testId: "test-1",
      logger: mockLogger as never,
    });

    expect(result).toEqual({
      taskFailureCount: 3,
      desiredCount: 10,
      healthyThreshold: 90,
      status: "running",
      testRunId: "run-123",
    });
  });

  it("throws when DynamoDB returns no Attributes", async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: undefined });

    await expect(
      incrementFailureCount({
        ddb,
        tableName: "scenarios",
        testId: "test-1",
        logger: mockLogger as never,
      })
    ).rejects.toThrow("DynamoDB returned no attributes");
  });

  it("uses ADD in the update expression", async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        taskFailureCount: 1,
        desiredTaskCount: 5,
        healthyThreshold: 80,
        status: "running",
        testRunId: "run-1",
      },
    });

    await incrementFailureCount({
      ddb,
      tableName: "scenarios",
      testId: "test-1",
      logger: mockLogger as never,
    });

    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call?.args[0].input.UpdateExpression).toBe("ADD taskFailureCount :one");
    expect(call?.args[0].input.ReturnValues).toBe("ALL_NEW");
    expect(call?.args[0].input.ConditionExpression).toBe("attribute_exists(testId)");
    expect(call?.args[0].input.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
  });
});

describe("isThresholdBreached", () => {
  it("returns true when healthy percentage is below threshold", () => {
    // 10 desired, 2 failed → 80% healthy, threshold 90% → breached
    expect(isThresholdBreached(2, 10, 90)).toBe(true);
  });

  it("returns false when healthy percentage equals threshold", () => {
    // 10 desired, 1 failed → 90% healthy, threshold 90% → not breached
    expect(isThresholdBreached(1, 10, 90)).toBe(false);
  });

  it("returns false when healthy percentage is above threshold", () => {
    // 100 desired, 5 failed → 95% healthy, threshold 90% → not breached
    expect(isThresholdBreached(5, 100, 90)).toBe(false);
  });

  it("returns true at exact boundary (just below threshold)", () => {
    // 100 desired, 11 failed → 89% healthy, threshold 90% → breached
    expect(isThresholdBreached(11, 100, 90)).toBe(true);
  });

  it("returns false when desiredCount is 0 (avoid division by zero)", () => {
    expect(isThresholdBreached(1, 0, 90)).toBe(false);
  });

  it("returns true when all tasks have failed", () => {
    expect(isThresholdBreached(10, 10, 90)).toBe(true);
  });

  it("returns false with a 0% threshold (never breach)", () => {
    expect(isThresholdBreached(9, 10, 0)).toBe(false);
  });

  it("returns true with a 100% threshold (any failure breaches)", () => {
    expect(isThresholdBreached(1, 10, 100)).toBe(true);
  });
});
