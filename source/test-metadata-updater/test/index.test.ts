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
      .mockResolvedValueOnce({}) // updateTestHistoryStatus (new entry — no Attributes)
      .mockResolvedValueOnce({}); // incrementTestRunCount

    await handler(makeEvent());

    expect(mockDdbSend).toHaveBeenCalledTimes(4);

    // GetCommand for scenario lookup
    expect(vi.mocked(GetCommand)).toHaveBeenCalledWith({
      TableName: "dlt-scenarios",
      Key: { testId: "test-abc123" },
    });

    // First UpdateCommand for scenario status
    expect(vi.mocked(UpdateCommand)).toHaveBeenCalledTimes(3);
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

    await expect(handler(makeEvent())).rejects.toThrow("Test Scenario object does not exist for testId=test-abc123");

    // Only the GetCommand should have been sent
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
  });

  it("should set endTime from the event on the scenario before writing history", async () => {
    const scenario = makeScenario();
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

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
      .mockResolvedValueOnce({}) // history update (new entry — no Attributes)
      .mockResolvedValueOnce({}); // incrementTestRunCount

    // Should not throw
    await handler(makeEvent());

    expect(mockDdbSend).toHaveBeenCalledTimes(4);
  });

  it("should include terminal state condition values in the scenario update", async () => {
    const scenario = makeScenario();
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

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
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockRejectedValueOnce(dbError);

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
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

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

  it("should copy nativeRunMode into the history record", async () => {
    const nativeRunMode = {
      maxTestDurationSeconds: 1800,
    };
    const scenario = makeScenario({ testType: "locust", nativeRunMode });
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await handler(makeEvent());

    const historyUpdateArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyUpdateArgs?.UpdateExpression).toContain(
      "nativeRunMode = if_not_exists(nativeRunMode, :nativeRunMode)"
    );
    expect(historyUpdateArgs?.ExpressionAttributeValues?.[":nativeRunMode"]).toEqual(nativeRunMode);
  });

  it("should omit nativeRunMode from Standard history records", async () => {
    const scenario = makeScenario();
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await handler(makeEvent());

    const historyUpdateArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(historyUpdateArgs?.UpdateExpression).not.toContain("nativeRunMode");
    expect(historyUpdateArgs?.ExpressionAttributeValues).not.toHaveProperty(":nativeRunMode");
  });

  it("should re-throw non-ConditionalCheckFailedException errors from history update", async () => {
    const scenario = makeScenario();
    const dbError = new Error("InternalServerError");
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockRejectedValueOnce(dbError);

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
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({});

    await expect(handler(makeEvent())).rejects.toThrow("Invalid JSON payload");
    expect(mockDdbSend).toHaveBeenCalledTimes(2);
  });

  it("should handle scenario with undefined optional fields", async () => {
    const scenario = makeScenario();
    delete scenario.testDescription;
    delete scenario.testType;
    delete scenario.testTaskConfigs;
    delete scenario.scheduleTimezone;
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

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
      mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

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
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockResolvedValueOnce({}) // history update (new entry — no Attributes)
      .mockResolvedValueOnce({}); // incrementTestRunCount

    await handler(makeEvent({ status: undefined, endTime: undefined }));

    expect(mockDdbSend).toHaveBeenCalledTimes(3);
    const historyArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(historyArgs?.ExpressionAttributeValues).toMatchObject({ ":startTime": "2025-01-01 00:00:00" });
  });

  it("should overwrite errorReason on scenarios table and use if_not_exists on history table", async () => {
    const scenario = makeScenario();
    mockDdbSend.mockReset();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockResolvedValueOnce({}) // scenario status/endTime update (guarded)
      .mockResolvedValueOnce({}) // scenario errorReason update (unconditional)
      .mockResolvedValueOnce({}); // updateTestHistoryStatus

    await handler(makeEvent({ status: TestStatus.FAILED, errorReason: "Regional sync failed" }));

    // Scenario status/endTime is guarded (terminal states immutable); errorReason
    // is a separate write that still lands on an already-`failed` scenario but is
    // blocked on `complete`/`cancelled` (single writer keeps it consistent with
    // the run record without stapling a failure reason onto a healthy outcome).
    const scenarioStatusArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioStatusArgs?.UpdateExpression).toContain("#s = :s");
    expect(scenarioStatusArgs?.UpdateExpression).not.toContain("#e");
    expect(scenarioStatusArgs?.ConditionExpression).toContain("#s <> :failed");

    const scenarioReasonArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(scenarioReasonArgs?.UpdateExpression).toBe("SET #e = :e");
    // Guarded on existence (no resurrection of a deleted scenario) and against the
    // successful terminal states, while still allowing the fast-fail `failed` case.
    expect(scenarioReasonArgs?.ConditionExpression).toBe(
      "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled"
    );
    expect(scenarioReasonArgs?.ExpressionAttributeNames).toMatchObject({ "#e": "errorReason", "#s": "status" });
    expect(scenarioReasonArgs?.ExpressionAttributeValues).toMatchObject({
      ":e": "Regional sync failed",
      ":complete": TestStatus.COMPLETE,
      ":cancelled": TestStatus.CANCELLED,
    });

    const historyArgs = vi.mocked(UpdateCommand).mock.calls[2]?.[0];
    expect(historyArgs?.UpdateExpression).toContain("if_not_exists(#e, :e)");
    expect(historyArgs?.ExpressionAttributeNames).toMatchObject({ "#s": "status", "#e": "errorReason" });
    expect(historyArgs?.ExpressionAttributeValues).toMatchObject({ ":e": "Regional sync failed" });
  });

  it("falls back to the scenario's errorReason for the run record when the event carries none", async () => {
    // A proximate writer (e.g. the Task Failure Handler on a healthy-threshold
    // breach) recorded the reason on the scenario, but the step function reached
    // this terminal write with an empty errorReason. The handler must propagate
    // the scenario's reason to both records so the run/history record is not left
    // blank while the scenario shows a specific cause.
    const detailedReason = "Task failure threshold breached: 1/1 tasks failed (healthy threshold: 90%)";
    const scenario = makeScenario({ status: TestStatus.FAILED, errorReason: detailedReason });
    mockDdbSend.mockReset();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockResolvedValueOnce({}) // scenario status/endTime update (guarded)
      .mockResolvedValueOnce({}) // scenario errorReason update (unconditional)
      .mockResolvedValueOnce({}); // updateTestHistoryStatus

    // Event carries status but NO errorReason (empty $.errorReason from the SFN).
    await handler(makeEvent({ status: TestStatus.FAILED }));

    // The scenario errorReason is (re)written with the reason it already had.
    const scenarioReasonArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(scenarioReasonArgs?.UpdateExpression).toBe("SET #e = :e");
    expect(scenarioReasonArgs?.ExpressionAttributeValues).toMatchObject({ ":e": detailedReason });

    // The run/history record now receives the same reason instead of nothing.
    const historyArgs = vi.mocked(UpdateCommand).mock.calls[2]?.[0];
    expect(historyArgs?.UpdateExpression).toContain("if_not_exists(#e, :e)");
    expect(historyArgs?.ExpressionAttributeValues).toMatchObject({ ":e": detailedReason });
  });

  it("prefers the event's errorReason over the scenario's when both are present", async () => {
    const scenario = makeScenario({ status: TestStatus.FAILED, errorReason: "stale proximate reason" });
    mockDdbSend.mockReset();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockResolvedValueOnce({}) // scenario status/endTime update (guarded)
      .mockResolvedValueOnce({}) // scenario errorReason update (unconditional)
      .mockResolvedValueOnce({}); // updateTestHistoryStatus

    await handler(makeEvent({ status: TestStatus.FAILED, errorReason: "Load test setup failed in 1 region: ..." }));

    const scenarioReasonArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(scenarioReasonArgs?.ExpressionAttributeValues).toMatchObject({
      ":e": "Load test setup failed in 1 region: ...",
    });
    const historyArgs = vi.mocked(UpdateCommand).mock.calls[2]?.[0];
    expect(historyArgs?.ExpressionAttributeValues).toMatchObject({
      ":e": "Load test setup failed in 1 region: ...",
    });
  });

  it("does not resurrect a scenario deleted before the errorReason write", async () => {
    // Race: run fails, user deletes the scenario, then this terminal write fires.
    // The errorReason write is guarded on attribute_exists(testId) (plus the
    // successful-terminal-state exclusions); the resulting
    // ConditionalCheckFailedException must be swallowed so no ghost record is
    // created and the step does not error.
    const scenario = makeScenario();
    mockDdbSend.mockReset();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockResolvedValueOnce({}) // scenario status/endTime update (guarded)
      .mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: "conditional request failed", $metadata: {} })
      ) // scenario errorReason update — scenario already deleted
      .mockResolvedValueOnce({}); // updateTestHistoryStatus

    await expect(
      handler(makeEvent({ status: TestStatus.FAILED, errorReason: "Regional sync failed" }))
    ).resolves.toBeUndefined();

    const scenarioReasonArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(scenarioReasonArgs?.ConditionExpression).toBe(
      "attribute_exists(testId) AND #s <> :complete AND #s <> :cancelled"
    );
  });

  it("guards the errorReason write against complete/cancelled so a healthy terminal run keeps no failure reason", async () => {
    // A late FAILED event (carrying an errorReason) reaches a scenario that has
    // already reached a successful/deliberate terminal state. The status write is
    // a no-op via the terminal guard; the errorReason write must ALSO be rejected
    // so a failure reason is never stapled onto a complete/cancelled record. Here
    // DynamoDB fails the condition and the handler swallows it as a no-op.
    const scenario = makeScenario({ status: TestStatus.COMPLETE });
    mockDdbSend.mockReset();
    mockDdbSend
      .mockResolvedValueOnce({ Item: scenario }) // getTestScenario
      .mockResolvedValueOnce({}) // scenario status/endTime update (guarded no-op)
      .mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: "conditional request failed", $metadata: {} })
      ) // scenario errorReason update — blocked by the complete/cancelled guard
      .mockResolvedValueOnce({}); // updateTestHistoryStatus

    await expect(
      handler(makeEvent({ status: TestStatus.FAILED, errorReason: "late failure reason" }))
    ).resolves.toBeUndefined();

    const scenarioReasonArgs = vi.mocked(UpdateCommand).mock.calls[1]?.[0];
    expect(scenarioReasonArgs?.ConditionExpression).toContain("#s <> :complete");
    expect(scenarioReasonArgs?.ConditionExpression).toContain("#s <> :cancelled");
  });

  it("should not write errorReason when it is an empty string", async () => {
    const scenario = makeScenario();
    mockDdbSend.mockResolvedValueOnce({ Item: scenario }).mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await handler(makeEvent({ status: TestStatus.COMPLETE, errorReason: "" }));

    const scenarioArgs = vi.mocked(UpdateCommand).mock.calls[0]?.[0];
    expect(scenarioArgs?.UpdateExpression).not.toContain("errorReason");
    expect(scenarioArgs?.ExpressionAttributeValues).not.toHaveProperty(":e");
  });
});
