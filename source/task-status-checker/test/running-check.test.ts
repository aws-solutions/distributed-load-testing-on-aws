// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkRunningStatus } from "../src/running-check.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeDdb(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
};

describe("checkRunningStatus", () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  it("should return isRunning true when status is running", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { status: "running" } });

    const result = await checkRunningStatus({
      ddb: makeDdb(),
      scenariosTable: "TestScenarios",
      testId: "test-abc123",
      logger: mockLogger as never,
    });

    expect(result).toEqual({ isRunning: true });
  });

  it.each(["complete", "cancelled", "failed"])("should return isRunning false when status is %s", async (status) => {
    ddbMock.on(GetCommand).resolves({ Item: { status } });

    const result = await checkRunningStatus({
      ddb: makeDdb(),
      scenariosTable: "TestScenarios",
      testId: "test-abc123",
      logger: mockLogger as never,
    });

    expect(result).toEqual({ isRunning: false });
  });

  it("should return isRunning false when item does not exist", async () => {
    ddbMock.on(GetCommand).resolves({});

    const result = await checkRunningStatus({
      ddb: makeDdb(),
      scenariosTable: "TestScenarios",
      testId: "nonexistent-test",
      logger: mockLogger as never,
    });

    expect(result).toEqual({ isRunning: false });
  });

  it("should propagate DynamoDB errors", async () => {
    ddbMock.on(GetCommand).rejects(new Error("DynamoDB unavailable"));

    await expect(
      checkRunningStatus({
        ddb: makeDdb(),
        scenariosTable: "TestScenarios",
        testId: "test-abc123",
        logger: mockLogger as never,
      })
    ).rejects.toThrow("DynamoDB unavailable");
  });
});
