// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { incrementTestRunCount, decrementTestRunCount } from "../src/scenario-counter";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

const mockSend = vi.fn();
const mockDdb = { send: mockSend } as any;

describe("scenario-counter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("incrementTestRunCount", () => {
    it("should send an UpdateCommand with correct parameters", async () => {
      mockSend.mockResolvedValueOnce({});
      await incrementTestRunCount(mockDdb, "test-table", "test-123");

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(UpdateCommand);
      expect(command.input).toEqual({
        TableName: "test-table",
        Key: { testId: "test-123" },
        UpdateExpression: "ADD totalTestRuns :inc",
        ExpressionAttributeValues: { ":inc": 1 },
        ConditionExpression: "attribute_exists(testId)",
      });
    });

    it("should use custom count when provided", async () => {
      mockSend.mockResolvedValueOnce({});
      await incrementTestRunCount(mockDdb, "test-table", "test-456", 5);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues).toEqual({ ":inc": 5 });
    });

    it("should not throw when DynamoDB fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

      await expect(incrementTestRunCount(mockDdb, "test-table", "test-789")).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to increment totalTestRuns for testId test-789:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("decrementTestRunCount", () => {
    it("should call incrementTestRunCount with negative count", async () => {
      mockSend.mockResolvedValueOnce({});
      await decrementTestRunCount(mockDdb, "test-table", "test-123");

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues).toEqual({ ":inc": -1 });
    });

    it("should use negative custom count when provided", async () => {
      mockSend.mockResolvedValueOnce({});
      await decrementTestRunCount(mockDdb, "test-table", "test-123", 3);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues).toEqual({ ":inc": -3 });
    });
  });
});
