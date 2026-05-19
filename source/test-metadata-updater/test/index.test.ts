// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestStatus } from "@amzn/dlt-common";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { handler } from "../src/index.js";

vi.mock("@amzn/dlt-common", async () => {
  const actual = await vi.importActual<typeof import("@amzn/dlt-common")>("@amzn/dlt-common");
  return {
    ...actual,
    getAwsClientConfig: vi.fn(() => ({})),
    getRequiredEnv: vi.fn((name: string) => {
      const envMap: Record<string, string> = {
        SOLUTION_ID: "SO0062",
        VERSION: "0.0.0",
        SCENARIOS_TABLE: "dlt-scenarios",
        HISTORY_TABLE: "dlt-history",
      };
      return envMap[name] ?? `mock-${name}`;
    }),
  };
});

const { mockDdbSend } = vi.hoisted(() => ({ mockDdbSend: vi.fn() }));
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(),
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    override readonly name = "ConditionalCheckFailedException";
  },
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDdbSend })) },
  GetCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

function makeEvent(overrides?: Record<string, unknown>) {
  return {
    testId: "test-abc123",
    testRunId: "run-001",
    status: TestStatus.RUNNING,
    endTime: "2025-12-01T00:00:00Z",
    ...overrides,
  };
}

function makeScenario(overrides?: Record<string, unknown>): any {
  return {
    testId: "test-abc123",
    testDescription: "Load test for checkout API",
    testType: "jmeter",
    testScenario: '{"execution":[{"scenario":"test"}]}',
    testTaskConfigs: [{ region: "us-east-1", taskCount: 5 }],
    scheduleTimezone: "UTC",
    startTime: "2025-01-01 00:00:00",
    ...overrides,
  };
}

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch the scenario, update scenario status, and update history status", async () => {
    const scenario = makeScenario();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockResolvedValueOnce({}) // updateTestScenarioStatus
      .mockResolvedValueOnce({}); // updateTestHistoryStatus

    await handler(makeEvent());

    expect(mockDdbSend).toHaveBeenCalledTimes(3);

    // GetCommand for scenario lookup
    expect(vi.mocked(GetCommand)).toHaveBeenCalledWith({
      TableName: "dlt-scenarios",
      Key: { testId: "test-abc123" },
    });

    // First UpdateCommand for scenario status
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledTimes(2);
    const scenarioUpdateArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioUpdateArgs?.TableName).toBe("dlt-scenarios");
    expect(scenarioUpdateArgs?.Key).toEqual({ testId: "test-abc123" });
    expect(scenarioUpdateArgs?.ExpressionAttributeValues).toMatchObject({ ":s": TestStatus.RUNNING });

    // Second UpdateCommand for history status
    const historyUpdateArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyUpdateArgs?.TableName).toBe("dlt-history");
    expect(historyUpdateArgs?.Key).toEqual({ testId: "test-abc123", testRunId: "run-001" });
    expect(historyUpdateArgs?.ExpressionAttributeValues).toMatchObject({
      ":s": TestStatus.RUNNING,
      ":testDescription": "Load test for checkout API",
      ":testType": "jmeter",
      ":testScenario": { execution: [{ scenario: "test" }] },
      ":testTaskConfigs": [{ region: "us-east-1", taskCount: 5 }],
      ":startTime": "2025-01-01 00:00:00",
      ":scheduleTimezone": "UTC",
    });
  });

  it("should throw when the test scenario does not exist", async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });

    await expect(handler(makeEvent())).rejects.toThrow(
      "Test Scenario object does not exist for testId=test-abc123",
    );

    // Only the GetCommand should have been sent
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
  });

  it("should set endTime from the event on the scenario before writing history", async () => {
    const scenario = makeScenario();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const customStart = "2025-06-15T12:30:00.000Z";
    await handler(makeEvent({ endTime: customStart }));

    const historyUpdateArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyUpdateArgs?.ExpressionAttributeValues).toMatchObject({
      ":startTime": "2025-01-01 00:00:00",
      ":endTime": "2025-06-15 12:30:00",
    });
  });
});

describe("updateTestScenarioStatus — terminal state guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should silently succeed when scenario is already in a terminal state", async () => {
    const scenario = makeScenario();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: "" })) // scenario update blocked
      .mockResolvedValueOnce({}); // history update

    // Should not throw
    await handler(makeEvent());

    expect(mockDdbSend).toHaveBeenCalledTimes(3);
  });

  it("should include terminal state condition values in the scenario update", async () => {
    const scenario = makeScenario();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(makeEvent({ status: TestStatus.PROVISIONING }));

    const scenarioUpdateArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioUpdateArgs?.ExpressionAttributeValues).toMatchObject({
      ":complete": TestStatus.COMPLETE,
      ":cancelled": TestStatus.CANCELLED,
      ":failed": TestStatus.FAILED,
    });
    expect(scenarioUpdateArgs?.ConditionExpression).toContain("#s <> :complete");
    expect(scenarioUpdateArgs?.ConditionExpression).toContain("#s <> :cancelled");
    expect(scenarioUpdateArgs?.ConditionExpression).toContain("#s <> :failed");
  });

  it("should re-throw non-ConditionalCheckFailedException errors from scenario update", async () => {
    const scenario = makeScenario();
    const dbError = new Error("ProvisionedThroughputExceededException");
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockRejectedValueOnce(dbError);

    await expect(handler(makeEvent())).rejects.toThrow("ProvisionedThroughputExceededException");
  });
});

describe("updateTestHistoryStatus — terminal state guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should silently succeed when history record is already in a terminal state", async () => {
    const scenario = makeScenario();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({}) // scenario update OK
      .mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: "" })); // history update blocked

    await handler(makeEvent());

    expect(mockDdbSend).toHaveBeenCalledTimes(3);
  });

  it("should use if_not_exists for non-status fields in history update", async () => {
    const scenario = makeScenario();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(makeEvent());

    const historyUpdateArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    const updateExpr = historyUpdateArgs?.UpdateExpression as string;
    expect(updateExpr).toContain("if_not_exists(testScenario, :testScenario)");
    expect(updateExpr).toContain("if_not_exists(testDescription, :testDescription)");
    expect(updateExpr).toContain("if_not_exists(testType, :testType)");
    expect(updateExpr).toContain("if_not_exists(testTaskConfigs, :testTaskConfigs)");
    expect(updateExpr).toContain("if_not_exists(startTime, :startTime)");
    expect(updateExpr).toContain("if_not_exists(scheduleTimezone, :scheduleTimezone)");
  });

  it("should re-throw non-ConditionalCheckFailedException errors from history update", async () => {
    const scenario = makeScenario();
    const dbError = new Error("InternalServerError");
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(dbError);

    await expect(handler(makeEvent())).rejects.toThrow("InternalServerError");
  });
});

describe("edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw error when testScenario field is invalid", async () => {
    const scenario = makeScenario();
    scenario.testScenario = '{"invalid":"json';
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({})

    await expect(handler(makeEvent())).rejects.toThrow("Invalid JSON payload");
    expect(mockDdbSend).toHaveBeenCalledTimes(2);
  });

  it("should handle scenario with undefined optional fields", async () => {
    const scenario = makeScenario();
    delete scenario.testDescription;
    delete scenario.testType;
    delete scenario.testTaskConfigs;
    delete scenario.scheduleTimezone;
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(makeEvent());

    const historyUpdateArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyUpdateArgs?.ExpressionAttributeValues).toMatchObject({
      ":testDescription": undefined,
      ":testType": undefined,
      ":testTaskConfigs": undefined,
      ":scheduleTimezone": undefined,
    });
  });

  it("should pass each supported status through to both updates", async () => {
    for (const status of [TestStatus.QUEUED, TestStatus.PROVISIONING, TestStatus.CLEANING_UP]) {
      vi.clearAllMocks();
      const scenario = makeScenario();
      mockDdbSend
        .mockResolvedValueOnce({ Item: scenario })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      await handler(makeEvent({ status }));

      const scenarioArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
      const historyArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
      expect(scenarioArgs?.ExpressionAttributeValues).toMatchObject({ ":s": status });
      expect(historyArgs?.ExpressionAttributeValues).toMatchObject({ ":s": status });
    }
  });
  it("should skip scenario update when status and endTime is not passed", async () => {
    const scenario = makeScenario();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
  
    await handler(makeEvent({ status: undefined, endTime: undefined}));

    expect(mockDdbSend).toHaveBeenCalledTimes(2);
    const historyArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(historyArgs?.ExpressionAttributeValues).toMatchObject({ ":startTime": "2025-01-01 00:00:00" });
  });
});
