// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.AWS_REGION = "us-east-1";
process.env.AGENT_SPACES_TABLE = "TestAgentSpacesTable";
process.env.AWS_ACCOUNT_ID = "123456789012";
process.env.SCENARIOS_TABLE = "TestScenariosTable";
process.env.HISTORY_TABLE = "TestHistoryTable";
process.env.HISTORY_TABLE_GSI_NAME = "TestGSI";
process.env.INVESTIGATIONS_TABLE = "TestInvestigationsTable";
process.env.CONSOLE_URL = "https://d123.cloudfront.net";

const mockDynamoDB = {
  scan: jest.fn(),
  put: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  batchGet: jest.fn(),
  query: jest.fn(),
};

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: { from: jest.fn(() => mockDynamoDB) },
}));
jest.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDB: jest.fn() }));
jest.mock("@aws-sdk/client-devops-agent", () => ({
  DevOpsAgentClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  GetAgentSpaceCommand: jest.fn(),
  CreateBacklogTaskCommand: jest.fn(),
  GetBacklogTaskCommand: jest.fn(),
  UpdateBacklogTaskCommand: jest.fn(),
  ListExecutionsCommand: jest.fn(),
  ListJournalRecordsCommand: jest.fn(),
}));
jest.mock("solution-utils", () => ({
  getOptions: jest.fn((opts) => opts || {}),
  sendMetric: jest.fn().mockResolvedValue(undefined),
}));

const mockCreateBacklogTask = jest.fn();
const mockGetBacklogTask = jest.fn();
const mockUpdateBacklogTask = jest.fn();
const mockListExecutions = jest.fn();
const mockListJournalRecords = jest.fn();
const mockGetAgentSpace = jest.fn();

jest.mock("../integrations/aidevops/client", () => ({
  getAgentSpace: mockGetAgentSpace,
  createBacklogTask: mockCreateBacklogTask,
  getBacklogTask: mockGetBacklogTask,
  updateBacklogTask: mockUpdateBacklogTask,
  listExecutions: mockListExecutions,
  listJournalRecords: mockListJournalRecords,
}));
jest.mock("../agent-spaces/", () => ({
  listAgentSpaces: jest.fn().mockResolvedValue([]),
  registerAgentSpace: jest.fn(),
  updateAgentSpace: jest.fn(),
  deregisterAgentSpace: jest.fn(),
  testConnection: jest.fn(),
}));

const { handler } = require("../../index");

// ─── Realistic SDK Fixtures (from TASK-W01) ──────────────────────────────────

const AGENT_SPACE_API_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TASK_ID = "11111111-2222-3333-4444-555555555555";
const EXECUTION_ID = "exe-ops1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const CREATE_BACKLOG_TASK_RESPONSE = {
  agentSpaceId: AGENT_SPACE_API_ID,
  taskId: TASK_ID,
  executionId: EXECUTION_ID,
  title: "Test Scenario — FAILED",
  description: "# DLT Performance Investigation...",
  taskType: "INVESTIGATION",
  priority: "HIGH",
  status: "PENDING_START",
  createdAt: "2026-05-27T04:45:12.735000+00:00",
  updatedAt: "2026-05-27T04:45:12.735000+00:00",
  version: 1,
  hasLinkedTasks: false,
};

const GET_BACKLOG_TASK_IN_PROGRESS = {
  agentSpaceId: AGENT_SPACE_API_ID,
  taskId: TASK_ID,
  executionId: EXECUTION_ID,
  title: "Test Scenario — FAILED",
  taskType: "INVESTIGATION",
  priority: "HIGH",
  status: "IN_PROGRESS",
  createdAt: "2026-05-27T04:45:12.735000+00:00",
  updatedAt: "2026-05-27T04:45:16.759000+00:00",
  version: 2,
  hasLinkedTasks: false,
};

const GET_BACKLOG_TASK_COMPLETED = {
  ...GET_BACKLOG_TASK_IN_PROGRESS,
  status: "COMPLETED",
  updatedAt: "2026-05-27T04:49:47.597000+00:00",
  version: 3,
};

const GET_BACKLOG_TASK_CANCELED = {
  agentSpaceId: AGENT_SPACE_API_ID,
  taskId: "22222222-3333-4444-5555-666666666666",
  executionId: "exe-ops1-11111111-2222-3333-4444-555555555555",
  taskType: "INVESTIGATION",
  priority: "MEDIUM",
  status: "CANCELED",
  createdAt: "2026-05-27T04:51:58.725000+00:00",
  updatedAt: "2026-05-27T04:52:31.978000+00:00",
  version: 3,
  metadata: { canceledReason: "USER_CANCELED" },
  hasLinkedTasks: false,
};

const LIST_EXECUTIONS_RESPONSE = {
  executions: [
    {
      agentSpaceId: AGENT_SPACE_API_ID,
      executionId: EXECUTION_ID,
      agentSubTask: "oncall",
      createdAt: "2026-05-26T21:45:12.735000-07:00",
      updatedAt: "2026-05-26T21:45:16.751000-07:00",
      executionStatus: "RUNNING",
      agentType: "ops1",
    },
  ],
};

const LIST_JOURNAL_RECORDS_INVESTIGATION = {
  records: [
    {
      agentSpaceId: AGENT_SPACE_API_ID,
      executionId: EXECUTION_ID,
      recordId: "2437a3b4-9247-401d-8939-978d2d3a9953",
      content: "# Investigation Summary\n\n## Root Cause\nLambda cold starts causing P99 latency spikes...",
      createdAt: "2026-05-26T21:49:46.776000-07:00",
      recordType: "investigation_summary_md",
    },
  ],
};

const LIST_JOURNAL_RECORDS_EMPTY = { records: [] };

function sdkError(name, message) {
  const err = new Error(message);
  err.name = name;
  err.$metadata = { httpStatusCode: name === "ResourceNotFoundException" ? 404 : name === "ConflictException" ? 409 : 403 };
  err.$fault = "client";
  return err;
}

// ─── Test Data ────────────────────────────────────────────────────────────────

const TEST_ID = "test-abc123";
const TEST_RUN_ID = "run-xyz789";
const AGENT_SPACE_INTERNAL_ID = "as-internal-001";

const TEST_RUN_RECORD = {
  testId: TEST_ID,
  testRunId: TEST_RUN_ID,
  testName: "Load Test Scenario",
  testType: "simple",
  status: "FAILED",
  startTime: "2026-05-26T21:30:00.000Z",
  endTime: "2026-05-26T21:35:00.000Z",
  results: JSON.stringify({ total: { avg_rt: "1.85", p99_0: "3.42", fail: 210, succ: 4790 } }),
};

const AGENT_SPACE_RECORD = {
  id: AGENT_SPACE_INTERNAL_ID,
  displayName: "Production Agent Space",
  agentSpaceArn: `arn:aws:aidevops:us-east-1:123456789012:agentspace/${AGENT_SPACE_API_ID}`,
};

const INVESTIGATION_RECORD = {
  testId: TEST_ID,
  "testRunId#investigationId": `${TEST_RUN_ID}#${TASK_ID}`,
  testRunId: TEST_RUN_ID,
  investigationId: TASK_ID,
  executionId: EXECUTION_ID,
  agentSpaceId: AGENT_SPACE_INTERNAL_ID,
  agentSpaceApiId: AGENT_SPACE_API_ID,
  agentSpaceName: "Production Agent Space",
  createdAt: "2026-05-27T04:45:12.735Z",
  archived: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiEvent(resource, method, opts = {}) {
  return {
    resource,
    httpMethod: method,
    body: opts.body ? JSON.stringify(opts.body) : null,
    pathParameters: opts.pathParameters ?? null,
    queryStringParameters: opts.queryStringParameters ?? null,
    headers: opts.headers ?? { "User-Agent": "integration-test" },
    requestContext: { identity: { cognitoIdentityId: "test-user" } },
  };
}

const ctx = { awsRequestId: "req-001", functionName: "test-fn", invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test-fn" };

function parse(response) {
  return { status: response.statusCode, data: JSON.parse(response.body) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Investigations API — full handler integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoDB.put.mockResolvedValue({});
    mockDynamoDB.update.mockResolvedValue({});
  });

  // ─── POST .../investigations (create) ─────────────────────────────────────

  describe("POST /scenarios/{testId}/testruns/{testRunId}/investigations", () => {
    const resource = "/scenarios/{testId}/testruns/{testRunId}/investigations";
    const pathParams = { testId: TEST_ID, testRunId: TEST_RUN_ID };

    it("creates an investigation successfully", async () => {
      mockDynamoDB.get
        .mockResolvedValueOnce({ Item: TEST_RUN_RECORD })
        .mockResolvedValueOnce({ Item: AGENT_SPACE_RECORD });
      mockDynamoDB.query.mockResolvedValue({ Items: [] });
      mockCreateBacklogTask.mockResolvedValue(CREATE_BACKLOG_TASK_RESPONSE);

      const { status, data } = parse(await handler(
        apiEvent(resource, "POST", { body: { agentSpaceId: AGENT_SPACE_INTERNAL_ID }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(201);
      expect(data.investigationId).toBe(TASK_ID);
      expect(data.executionId).toBe(EXECUTION_ID);
      expect(data.status).toBe("PENDING_START");
      expect(mockCreateBacklogTask).toHaveBeenCalledWith(expect.objectContaining({
        agentSpaceId: AGENT_SPACE_API_ID,
        taskType: "INVESTIGATION",
        priority: "HIGH",
      }));
      expect(mockDynamoDB.put).toHaveBeenCalledTimes(2);
    });

    it("returns 404 when test run does not exist", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: undefined });

      const { status, data } = parse(await handler(
        apiEvent(resource, "POST", { body: { agentSpaceId: AGENT_SPACE_INTERNAL_ID }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(404);
      expect(data).toContain("not found");
    });

    it("returns 409 when non-archived investigation already exists", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: TEST_RUN_RECORD });
      mockDynamoDB.query.mockResolvedValue({ Items: [INVESTIGATION_RECORD] });

      const { status, data } = parse(await handler(
        apiEvent(resource, "POST", { body: { agentSpaceId: AGENT_SPACE_INTERNAL_ID }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(409);
      expect(data).toContain("already exists");
    });

    it("returns 400 when agentSpaceId is missing", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: TEST_RUN_RECORD });
      mockDynamoDB.query.mockResolvedValue({ Items: [] });

      const { status } = parse(await handler(
        apiEvent(resource, "POST", { body: {}, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(400);
    });

    it("returns 404 when agent space not found in DDB", async () => {
      mockDynamoDB.get
        .mockResolvedValueOnce({ Item: TEST_RUN_RECORD })
        .mockResolvedValueOnce({ Item: undefined });
      mockDynamoDB.query.mockResolvedValue({ Items: [] });

      const { status, data } = parse(await handler(
        apiEvent(resource, "POST", { body: { agentSpaceId: "nonexistent" }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(404);
      expect(data).toContain("Agent Space");
    });

    it("returns 400 when additional context contains secrets", async () => {
      mockDynamoDB.get
        .mockResolvedValueOnce({ Item: TEST_RUN_RECORD })
        .mockResolvedValueOnce({ Item: AGENT_SPACE_RECORD });
      mockDynamoDB.query.mockResolvedValue({ Items: [] });

      const { status, data } = parse(await handler(
        apiEvent(resource, "POST", { body: { agentSpaceId: AGENT_SPACE_INTERNAL_ID, additionalContext: "key=AKIAIOSFODNN7EXAMPLE" }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(400);
      expect(data).toContain("sensitive");
    });

    it("returns 429 on ThrottlingException from CreateBacklogTask", async () => {
      mockDynamoDB.get
        .mockResolvedValueOnce({ Item: TEST_RUN_RECORD })
        .mockResolvedValueOnce({ Item: AGENT_SPACE_RECORD });
      mockDynamoDB.query.mockResolvedValue({ Items: [] });
      mockCreateBacklogTask.mockRejectedValue(sdkError("ThrottlingException", "Rate exceeded"));

      const response = await handler(
        apiEvent(resource, "POST", { body: { agentSpaceId: AGENT_SPACE_INTERNAL_ID }, pathParameters: pathParams }), ctx
      );

      expect(response.statusCode).toBe(429);
      expect(response.headers["Retry-After"]).toBeDefined();
    });
  });

  // ─── GET .../investigations (list) ────────────────────────────────────────

  describe("GET /scenarios/{testId}/testruns/{testRunId}/investigations", () => {
    const resource = "/scenarios/{testId}/testruns/{testRunId}/investigations";
    const pathParams = { testId: TEST_ID, testRunId: TEST_RUN_ID };

    it("returns all investigations including archived", async () => {
      mockDynamoDB.query.mockResolvedValue({ Items: [INVESTIGATION_RECORD, { ...INVESTIGATION_RECORD, archived: true }] });

      const { status, data } = parse(await handler(apiEvent(resource, "GET", { pathParameters: pathParams }), ctx));

      expect(status).toBe(200);
      expect(data).toHaveLength(2);
    });

    it("returns empty array when no investigations exist", async () => {
      mockDynamoDB.query.mockResolvedValue({ Items: [] });

      const { status, data } = parse(await handler(apiEvent(resource, "GET", { pathParameters: pathParams }), ctx));

      expect(status).toBe(200);
      expect(data).toEqual([]);
    });
  });

  // ─── GET .../investigations/{investigationId}/status ───────────────────────

  describe("GET .../investigations/{investigationId}/status", () => {
    const resource = "/scenarios/{testId}/testruns/{testRunId}/investigations/{investigationId}/status";
    const pathParams = { testId: TEST_ID, testRunId: TEST_RUN_ID, investigationId: TASK_ID };

    it("returns IN_PROGRESS status", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_IN_PROGRESS);

      const { status, data } = parse(await handler(apiEvent(resource, "GET", { pathParameters: pathParams }), ctx));

      expect(status).toBe(200);
      expect(data.status).toBe("IN_PROGRESS");
      expect(data.investigationId).toBe(TASK_ID);
    });

    it("returns COMPLETED status", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_COMPLETED);

      const { status, data } = parse(await handler(apiEvent(resource, "GET", { pathParameters: pathParams }), ctx));

      expect(status).toBe(200);
      expect(data.status).toBe("COMPLETED");
    });

    it("returns 404 when investigation not found", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: undefined });

      const { status } = parse(await handler(apiEvent(resource, "GET", { pathParameters: pathParams }), ctx));

      expect(status).toBe(404);
    });
  });

  // ─── GET .../investigations/{investigationId}/findings ─────────────────────

  describe("GET .../investigations/{investigationId}/findings", () => {
    const resource = "/scenarios/{testId}/testruns/{testRunId}/investigations/{investigationId}/findings";
    const pathParams = { testId: TEST_ID, testRunId: TEST_RUN_ID, investigationId: TASK_ID };

    it("returns investigation findings markdown", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockListJournalRecords.mockResolvedValue(LIST_JOURNAL_RECORDS_INVESTIGATION);

      const { status, data } = parse(await handler(
        apiEvent(resource, "GET", { pathParameters: pathParams, queryStringParameters: { type: "investigation" } }), ctx
      ));

      expect(status).toBe(200);
      expect(data.findings).toContain("Investigation Summary");
      expect(data.recordType).toBe("investigation_summary_md");
      expect(data.recordId).toBe("2437a3b4-9247-401d-8939-978d2d3a9953");
    });

    it("returns null findings when no records exist", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockListJournalRecords.mockResolvedValue(LIST_JOURNAL_RECORDS_EMPTY);

      const { status, data } = parse(await handler(
        apiEvent(resource, "GET", { pathParameters: pathParams, queryStringParameters: { type: "investigation" } }), ctx
      ));

      expect(status).toBe(200);
      expect(data.findings).toBeNull();
    });

    it("falls back to all record types when typed query returns empty", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockListJournalRecords
        .mockResolvedValueOnce(LIST_JOURNAL_RECORDS_EMPTY)
        .mockResolvedValueOnce(LIST_JOURNAL_RECORDS_INVESTIGATION);

      const { status, data } = parse(await handler(
        apiEvent(resource, "GET", { pathParameters: pathParams, queryStringParameters: { type: "investigation" } }), ctx
      ));

      expect(status).toBe(200);
      expect(data.findings).toContain("Investigation Summary");
      expect(mockListJournalRecords).toHaveBeenCalledTimes(2);
    });

    it("returns 404 for mitigation when no mitigation execution exists", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockListExecutions.mockResolvedValue({ executions: [] });

      const { status } = parse(await handler(
        apiEvent(resource, "GET", { pathParameters: pathParams, queryStringParameters: { type: "mitigation" } }), ctx
      ));

      expect(status).toBe(404);
    });
  });

  // ─── PUT .../investigations/{investigationId} (cancel) ─────────────────────

  describe("PUT .../investigations/{investigationId} (cancel)", () => {
    const resource = "/scenarios/{testId}/testruns/{testRunId}/investigations/{investigationId}";
    const pathParams = { testId: TEST_ID, testRunId: TEST_RUN_ID, investigationId: TASK_ID };

    it("cancels an in-progress investigation", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_IN_PROGRESS);
      mockUpdateBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_CANCELED);

      const { status, data } = parse(await handler(
        apiEvent(resource, "PUT", { body: { action: "cancel" }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(200);
      expect(data.status).toBe("CANCELED");
      expect(data.archived).toBe(true);
      expect(mockUpdateBacklogTask).toHaveBeenCalledWith(expect.objectContaining({ taskStatus: "CANCELED" }));
      expect(mockDynamoDB.update).toHaveBeenCalled();
    });

    it("returns 409 when investigation is already in terminal state", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_COMPLETED);

      const { status, data } = parse(await handler(
        apiEvent(resource, "PUT", { body: { action: "cancel" }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(409);
      expect(data).toContain("terminal");
    });

    it("returns 400 when body action is not 'cancel'", async () => {
      const { status } = parse(await handler(
        apiEvent(resource, "PUT", { body: { action: "invalid" }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(400);
    });

    it("returns 500 on unexpected ConflictException from UpdateBacklogTask", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_IN_PROGRESS);
      mockUpdateBacklogTask.mockRejectedValue(sdkError("ConflictException", "Cannot cancel task in COMPLETED status"));

      const response = await handler(
        apiEvent(resource, "PUT", { body: { action: "cancel" }, pathParameters: pathParams }), ctx
      );

      expect(response.statusCode).toBe(500);
    });

    it("is idempotent when already CANCELED", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_CANCELED);

      const { status, data } = parse(await handler(
        apiEvent(resource, "PUT", { body: { action: "cancel" }, pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(200);
      expect(data.archived).toBe(true);
      expect(mockUpdateBacklogTask).not.toHaveBeenCalled();
    });
  });

  // ─── DELETE .../investigations/{investigationId} (archive) ─────────────────

  describe("DELETE .../investigations/{investigationId} (archive)", () => {
    const resource = "/scenarios/{testId}/testruns/{testRunId}/investigations/{investigationId}";
    const pathParams = { testId: TEST_ID, testRunId: TEST_RUN_ID, investigationId: TASK_ID };

    it("archives a completed investigation", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_COMPLETED);

      const { status, data } = parse(await handler(
        apiEvent(resource, "DELETE", { pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(200);
      expect(data.archived).toBe(true);
      expect(mockDynamoDB.update).toHaveBeenCalled();
    });

    it("returns 409 when investigation is not in terminal state", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: INVESTIGATION_RECORD });
      mockGetBacklogTask.mockResolvedValue(GET_BACKLOG_TASK_IN_PROGRESS);

      const { status, data } = parse(await handler(
        apiEvent(resource, "DELETE", { pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(409);
      expect(data).toContain("Cancel it first");
    });

    it("returns 404 when investigation not found", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: undefined });

      const { status } = parse(await handler(
        apiEvent(resource, "DELETE", { pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(404);
    });

    it("is idempotent when already archived", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: { ...INVESTIGATION_RECORD, archived: true } });

      const { status, data } = parse(await handler(
        apiEvent(resource, "DELETE", { pathParameters: pathParams }), ctx
      ));

      expect(status).toBe(200);
      expect(data.archived).toBe(true);
    });
  });
});
