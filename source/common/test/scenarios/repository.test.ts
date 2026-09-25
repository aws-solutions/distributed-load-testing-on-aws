// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ScenariosRepository } from "../../src/scenarios/repository.ts";
import { ConflictError, NotFoundError, InvalidDataError } from "../../src/data/errors.ts";
import { ACTIVE_RUN_STATUSES, CANCELABLE_RUN_STATUSES, TestStatus } from "../../src/test-execution.ts";

// mockClient patches the client prototype, so a real instance created here is
// intercepted.
// https://github.com/m-radzikowski/aws-sdk-client-mock#usage
const ddbMock = mockClient(DynamoDBDocumentClient);

const repo = new ScenariosRepository({
  ddbClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName: "TestTable",
});

const validRecord = {
  testId: "test-1",
  testName: "My Test",
  testType: "simple",
  status: "running",
  testTaskConfigs: [{ region: "us-east-1", taskCount: 5, concurrency: 5 }],
  testScenario: '{"execution":[{"hold-for":"1m"}]}',
  desiredTaskCount: 5,
  taskFailureCount: 0,
};

describe("ScenariosRepository", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe("get", () => {
    it("returns data when item is valid", async () => {
      ddbMock.on(GetCommand).resolves({ Item: validRecord });

      const result = await repo.get("test-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(validRecord);
      }
    });

    it("sends GetCommand with correct table and key", async () => {
      ddbMock.on(GetCommand).resolves({ Item: validRecord });

      await repo.get("test-1");

      expect(ddbMock.commandCalls(GetCommand)[0]?.args[0].input).toEqual({
        TableName: "TestTable",
        Key: { testId: "test-1" },
      });
    });

    it("returns NotFoundError when item does not exist", async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await repo.get("missing");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(NotFoundError);
        expect(result.error.message).toContain("missing");
      }
    });

    it("returns InvalidDataError when item fails schema validation", async () => {
      ddbMock.on(GetCommand).resolves({ Item: { testId: "bad" } });

      const result = await repo.get("bad");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(InvalidDataError);
      }
    });

    it("defaults desiredTaskCount and taskFailureCount when missing", async () => {
      const itemWithoutCounters = {
        testId: "test-1",
        testName: "My Test",
        testType: "simple",
        status: "running",
        testTaskConfigs: [{ region: "us-east-1", taskCount: "5", concurrency: "5" }],
        testScenario: '{"execution":[{"hold-for":"1m"}]}',
      };
      ddbMock.on(GetCommand).resolves({ Item: itemWithoutCounters });

      const result = await repo.get("test-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.desiredTaskCount).toBe(0);
        expect(result.data.taskFailureCount).toBe(0);
      }
    });

    it("preserves extra fields via passthrough", async () => {
      ddbMock.on(GetCommand).resolves({ Item: { ...validRecord, futureField: "hello" } });

      const result = await repo.get("test-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>)["futureField"]).toBe("hello");
      }
    });

    it("coerces legacy string taskCount/concurrency to numbers", async () => {
      const legacyRecord = {
        ...validRecord,
        testTaskConfigs: [{ region: "us-east-1", taskCount: "5", concurrency: "10" }],
      };
      ddbMock.on(GetCommand).resolves({ Item: legacyRecord });

      const result = await repo.get("test-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.testTaskConfigs[0]?.taskCount).toBe(5);
        expect(result.data.testTaskConfigs[0]?.concurrency).toBe(10);
      }
    });
  });

  describe("tryClaimRunSlot", () => {
    it("claims the slot with an atomic conditional write to queued", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await repo.tryClaimRunSlot("test-1");

      expect(result.ok).toBe(true);
      const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
      expect(input?.TableName).toBe("TestTable");
      expect(input?.Key).toEqual({ testId: "test-1" });
      expect(input?.UpdateExpression).toBe("SET #status = :queued");
      expect(input?.ExpressionAttributeValues?.[":queued"]).toBe(TestStatus.QUEUED);
      // The condition must reference every active-run status so it cannot drift
      // from the single source of truth.
      const values = (input?.ExpressionAttributeValues ?? {}) as Record<string, string>;
      const guardedStatuses = Object.entries(values)
        .filter(([key]) => key.startsWith(":active"))
        .map(([, value]) => value);
      expect(new Set(guardedStatuses)).toEqual(new Set(ACTIVE_RUN_STATUSES));
      expect(input?.ConditionExpression).toContain("attribute_not_exists(#status) OR NOT (#status IN (");
    });

    it("returns ConflictError when an active run already holds the slot", async () => {
      ddbMock
        .on(UpdateCommand)
        .rejects(new ConditionalCheckFailedException({ message: "conditional request failed", $metadata: {} }));

      const result = await repo.tryClaimRunSlot("test-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ConflictError);
        expect(result.error.message).toContain("test-1");
      }
    });

    it("propagates unexpected infrastructure errors", async () => {
      ddbMock.on(UpdateCommand).rejects(new Error("network unreachable"));

      await expect(repo.tryClaimRunSlot("test-1")).rejects.toThrow("network unreachable");
    });
  });

  describe("tryTransitionToCancelling", () => {
    it("transitions to cancelling with an atomic write gated on cancelable statuses", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await repo.tryTransitionToCancelling("test-1");

      expect(result.ok).toBe(true);
      const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
      expect(input?.TableName).toBe("TestTable");
      expect(input?.Key).toEqual({ testId: "test-1" });
      expect(input?.UpdateExpression).toBe("SET #status = :cancelling");
      expect(input?.ExpressionAttributeValues?.[":cancelling"]).toBe(TestStatus.CANCELLING);
      // The condition must reference exactly the cancelable statuses so it cannot
      // drift, and must NOT include the finishing states (CLEANING_UP,
      // PARSING_RESULTS) where a cancel would race the terminal metadata write.
      const values = (input?.ExpressionAttributeValues ?? {}) as Record<string, string>;
      const guardedStatuses = Object.entries(values)
        .filter(([key]) => key.startsWith(":cancelable"))
        .map(([, value]) => value);
      expect(new Set(guardedStatuses)).toEqual(new Set(CANCELABLE_RUN_STATUSES));
      expect(guardedStatuses).not.toContain(TestStatus.CLEANING_UP);
      expect(guardedStatuses).not.toContain(TestStatus.PARSING_RESULTS);
      expect(input?.ConditionExpression).toContain("#status IN (");
    });

    it("returns ConflictError when the run is not in a cancelable state (nothing to cancel)", async () => {
      ddbMock
        .on(UpdateCommand)
        .rejects(new ConditionalCheckFailedException({ message: "conditional request failed", $metadata: {} }));

      const result = await repo.tryTransitionToCancelling("test-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ConflictError);
        expect(result.error.message).toContain("test-1");
      }
    });

    it("propagates unexpected infrastructure errors", async () => {
      ddbMock.on(UpdateCommand).rejects(new Error("network unreachable"));

      await expect(repo.tryTransitionToCancelling("test-1")).rejects.toThrow("network unreachable");
    });
  });
});
