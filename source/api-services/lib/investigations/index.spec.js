// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.AWS_REGION = "us-east-1";
process.env.HISTORY_TABLE = "dlt-history";
process.env.INVESTIGATIONS_TABLE = "dlt-investigations";
process.env.AGENT_SPACES_TABLE = "dlt-agent-spaces";
process.env.CONSOLE_URL = "https://dlt.example.com";
process.env.SCENARIOS_BUCKET = "dlt-scenarios";

const mockGet = jest.fn();
const mockQuery = jest.fn();
const mockPut = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDB: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn().mockReturnValue({
      get: mockGet,
      query: mockQuery,
      put: mockPut,
      update: mockUpdate,
      delete: mockDelete,
    }),
  },
}));

jest.mock("solution-utils", () => ({
  getOptions: jest.fn().mockReturnValue({ region: "us-east-1" }),
}));

const mockCreateBacklogTask = jest.fn();
const mockGetBacklogTask = jest.fn();
const mockUpdateBacklogTask = jest.fn();
const mockListExecutions = jest.fn();
const mockListJournalRecords = jest.fn();
const mockCreateAsset = jest.fn();
const mockDeleteAsset = jest.fn();

jest.mock("../integrations/aidevops", () => ({
  createBacklogTask: mockCreateBacklogTask,
  getBacklogTask: mockGetBacklogTask,
  updateBacklogTask: mockUpdateBacklogTask,
  listExecutions: mockListExecutions,
  listJournalRecords: mockListJournalRecords,
  createAsset: mockCreateAsset,
  deleteAsset: mockDeleteAsset,
}));

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  ListObjectsV2Command: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

const { ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");

const {
  createInvestigation,
  listInvestigations,
  getInvestigationStatus,
  getInvestigationFindings,
  cancelInvestigation,
  archiveInvestigation,
} = require("./index");

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const mockTestRun = {
  testId: "test-abc",
  testRunId: "run-001",
  testName: "My Load Test",
  testType: "simple",
  status: "completed",
  startTime: "2026-05-20T10:00:00.000Z",
  endTime: "2026-05-20T10:10:00.000Z",
  results: JSON.stringify({ avg: 200, p50: 180, p90: 350, p99: 700 }),
};

const mockAgentSpace = {
  id: "as-123",
  displayName: "Test Agent Space",
  agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space",
};

const mockTaskResult = {
  taskId: "task-xyz",
  executionId: "exec-xyz",
  status: "PENDING_TRIAGE",
  agentSpaceId: "my-space",
};

const mockInvestigation = {
  testId: "test-abc",
  "testRunId#investigationId": "run-001#task-xyz",
  investigationId: "task-xyz",
  testRunId: "run-001",
  executionId: "exec-xyz",
  agentSpaceId: "as-123",
  agentSpaceApiId: "my-space",
  agentSpaceName: "Test Agent Space",
  createdAt: "2026-05-20T10:00:00.000Z",
  archived: false,
};

const baseParams = {
  testId: "test-abc",
  testRunId: "run-001",
  investigationId: "task-xyz",
  body: { agentSpaceId: "as-123" },
  correlationId: "corr-001",
  requesterCognitoSub: "user-sub-001",
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockQuery.mockResolvedValue({ Items: [] });
  mockPut.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
  mockDelete.mockResolvedValue({});
  // Default: any dynamoDB.get beyond the first two (testRun, agentSpace) returns
  // an empty item (scenario with no baseline, or lock-not-found). Tests that need
  // specific responses for the 3rd/4th get call override with mockResolvedValueOnce.
  mockGet.mockResolvedValue({ Item: {} });
  mockCreateBacklogTask.mockResolvedValue(mockTaskResult);
  mockDeleteAsset.mockResolvedValue({});
  // resetAllMocks wipes the command-class mock implementations, so re-tag them
  // each test. The tag lets mockS3Send route list vs get commands.
  ListObjectsV2Command.mockImplementation((input) => ({ __command: "list", input }));
  GetObjectCommand.mockImplementation((input) => ({ __command: "get", input }));
  // Default: no S3 objects, so create-flow tests resolve no artifacts (matches
  // prior behavior where artifact upload yielded null). Artifact-specific tests
  // override mockS3Send.
  mockS3Send.mockResolvedValue({ Contents: [], CommonPrefixes: [] });
});

afterEach(() => {
  console.log.mockRestore();
  console.warn.mockRestore();
});

// ─── createInvestigation ─────────────────────────────────────────────

describe("createInvestigation", () => {
  it("should create an investigation successfully", async () => {
    mockGet
      .mockResolvedValueOnce({ Item: mockTestRun })
      .mockResolvedValueOnce({ Item: mockAgentSpace });

    const result = await createInvestigation(baseParams);

    expect(result.investigationId).toBe("task-xyz");
    expect(result.executionId).toBe("exec-xyz");
    expect(result.agentSpaceId).toBe("as-123");
    expect(result.agentSpaceName).toBe("Test Agent Space");
    expect(result.status).toBe("PENDING_TRIAGE");
    expect(result.createdAt).toBeDefined();
  });

  it("should call createBacklogTask with correct parameters", async () => {
    mockGet
      .mockResolvedValueOnce({ Item: mockTestRun })
      .mockResolvedValueOnce({ Item: mockAgentSpace });

    await createInvestigation(baseParams);

    expect(mockCreateBacklogTask).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSpaceId: "my-space",
        taskType: "INVESTIGATION",
        priority: "HIGH",
        correlationId: "corr-001",
        requesterCognitoSub: "user-sub-001",
      }),
    );
    const callArgs = mockCreateBacklogTask.mock.calls[0][0];
    expect(callArgs.title.length).toBeLessThanOrEqual(400);
    expect(callArgs.description.length).toBeLessThanOrEqual(10000);
    expect(callArgs.clientToken).toBeDefined();
    expect(callArgs.reference).toBeUndefined();
  });

  it("should return 404 when test run does not exist", async () => {
    mockGet.mockResolvedValueOnce({ Item: null });
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "TESTRUN_NOT_FOUND", statusCode: 404 });
  });

  it("should return 409 when a non-archived investigation already exists", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun });
    mockQuery.mockResolvedValueOnce({ Items: [{ investigationId: "existing", archived: false }] });
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "INVESTIGATION_ALREADY_EXISTS", statusCode: 409 });
    expect(mockCreateBacklogTask).not.toHaveBeenCalled();
  });

  it("should return 400 when agentSpaceId is missing from body", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun });
    await expect(createInvestigation({ ...baseParams, body: {} })).rejects.toMatchObject({ code: "MISSING_AGENT_SPACE", statusCode: 400 });
  });

  it("should return 404 when Agent Space is not found in DDB", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: null });
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "AGENT_SPACE_NOT_FOUND", statusCode: 404 });
  });

  it("should return 429 with retryAfter on ThrottlingException", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("throttled"); err.name = "ThrottlingException";
    mockCreateBacklogTask.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "THROTTLED", statusCode: 429, retryAfter: 10 });
  });

  it("should return 400 on ContentSizeExceededException", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("too large"); err.name = "ContentSizeExceededException";
    mockCreateBacklogTask.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "DESCRIPTION_TOO_LARGE", statusCode: 400 });
  });

  it("should return 404 on AccessDeniedException", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("denied"); err.name = "AccessDeniedException";
    mockCreateBacklogTask.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 404 });
  });

  it("should return 404 on ResourceNotFoundException", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("not found"); err.name = "ResourceNotFoundException";
    mockCreateBacklogTask.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "AGENT_SPACE_NOT_FOUND_REMOTE", statusCode: 404 });
  });

  it("should return 500 on unexpected errors", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    mockCreateBacklogTask.mockRejectedValueOnce(new Error("unexpected"));
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "AIDEVOPS_ERROR", statusCode: 500 });
  });

  it("should return a friendly message on a server-fault SDK error", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("internal failure detail"); err.$fault = "server";
    mockCreateBacklogTask.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({
      code: "AIDEVOPS_ERROR",
      statusCode: 500,
      message: "There was an error sending your investigation to DevOps Agent.",
    });
  });

  it("should return a friendly message on a 5xx http status from the agent", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("service unavailable"); err.$metadata = { httpStatusCode: 503 };
    mockCreateBacklogTask.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({
      code: "AIDEVOPS_ERROR",
      statusCode: 500,
      message: "There was an error sending your investigation to DevOps Agent.",
    });
  });

  it("should keep the raw message for unmapped 4xx errors", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("1 validation error detected"); err.name = "ValidationException"; err.$fault = "client"; err.$metadata = { httpStatusCode: 400 };
    mockCreateBacklogTask.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({
      code: "AIDEVOPS_ERROR",
      message: "DevOps Agent API error: 1 validation error detected",
    });
  });

  it("should return 409 on ConditionalCheckFailedException (TOCTOU race)", async () => {
    mockGet
      .mockResolvedValueOnce({ Item: mockTestRun })
      .mockResolvedValueOnce({ Item: mockAgentSpace })
      .mockResolvedValueOnce({ Item: {} }) // scenario (no baseline)
      .mockResolvedValueOnce({ Item: { createdAt: new Date().toISOString() } }); // fresh lock
    const err = new Error("condition failed"); err.name = "ConditionalCheckFailedException";
    mockPut.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "INVESTIGATION_ALREADY_EXISTS", statusCode: 409 });
  });

  it("should write correct record to InvestigationsTable", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({
      TableName: "dlt-investigations",
      Item: expect.objectContaining({ testId: "test-abc", "testRunId#investigationId": "run-001#task-xyz", archived: false }),
      ConditionExpression: "attribute_not_exists(testId)",
    }));
  });

  it("should include additionalContext in description", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation({ ...baseParams, body: { agentSpaceId: "as-123", additionalContext: "Deployment at 10:05." } });
    expect(mockCreateBacklogTask.mock.calls[0][0].description).toContain("Deployment at 10:05.");
  });

  it("should reject context containing AWS access key", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await expect(createInvestigation({ ...baseParams, body: { agentSpaceId: "as-123", additionalContext: "AKIAIOSFODNN7EXAMPLE" } }))
      .rejects.toMatchObject({ code: "CONTEXT_CONTAINS_SENSITIVE_DATA", statusCode: 400 });
    expect(mockCreateBacklogTask).not.toHaveBeenCalled();
  });

  it("should reject context containing JWT", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    await expect(createInvestigation({ ...baseParams, body: { agentSpaceId: "as-123", additionalContext: jwt } }))
      .rejects.toMatchObject({ code: "CONTEXT_CONTAINS_SENSITIVE_DATA", statusCode: 400 });
  });
});

// ─── listInvestigations ──────────────────────────────────────────────

describe("listInvestigations", () => {
  it("should return all investigations for a test run", async () => {
    mockQuery.mockResolvedValueOnce({ Items: [mockInvestigation, { ...mockInvestigation, investigationId: "task-old", archived: true }] });
    const result = await listInvestigations({ testId: "test-abc", testRunId: "run-001" });
    expect(result).toHaveLength(2);
  });

  it("should return empty array when no investigations exist", async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    const result = await listInvestigations({ testId: "test-abc", testRunId: "run-001" });
    expect(result).toEqual([]);
  });
});

// ─── getInvestigationStatus ──────────────────────────────────────────

describe("getInvestigationStatus", () => {
  beforeEach(() => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
  });

  it("should return status from GetBacklogTask", async () => {
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS", statusReason: null, agentSpaceId: "my-space" });
    const result = await getInvestigationStatus(baseParams);
    expect(result.status).toBe("IN_PROGRESS");
    expect(result.investigationId).toBe("task-xyz");
  });

  it("should not include mitigation fields (mitigation excluded from this branch)", async () => {
    mockGetBacklogTask.mockResolvedValueOnce({ status: "COMPLETED", agentSpaceId: "my-space" });
    const result = await getInvestigationStatus(baseParams);
    expect(result.mitigationExecutionId).toBeUndefined();
    expect(result.mitigationState).toBeUndefined();
  });

  it("should pass through unknown statuses with warning", async () => {
    mockGetBacklogTask.mockResolvedValueOnce({ status: "NEW_STATUS", agentSpaceId: "my-space" });
    const result = await getInvestigationStatus(baseParams);
    expect(result.status).toBe("NEW_STATUS");
    expect(console.warn).toHaveBeenCalled();
  });

  it("should return 404 when investigation not found", async () => {
    mockGet.mockReset().mockResolvedValueOnce({ Item: null });
    await expect(getInvestigationStatus(baseParams)).rejects.toMatchObject({ code: "INVESTIGATION_NOT_FOUND", statusCode: 404 });
  });

  it("should return 429 on ThrottlingException", async () => {
    const err = new Error("throttled"); err.name = "ThrottlingException";
    mockGetBacklogTask.mockRejectedValueOnce(err);
    await expect(getInvestigationStatus(baseParams)).rejects.toMatchObject({ code: "THROTTLED", statusCode: 429 });
  });
});

// ─── getInvestigationFindings ────────────────────────────────────────

describe("getInvestigationFindings", () => {
  beforeEach(() => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
  });

  it("should return investigation findings", async () => {
    mockListJournalRecords.mockResolvedValueOnce({ records: [{ recordId: "r-1", recordType: "investigation_summary_md", content: "# Root Cause", createdAt: 1000 }] });
    const result = await getInvestigationFindings({ ...baseParams, type: "investigation" });
    expect(result.findings).toBe("# Root Cause");
  });

  it("should fall back to all types when typed query empty", async () => {
    mockListJournalRecords.mockResolvedValueOnce({ records: [] }).mockResolvedValueOnce({ records: [{ recordId: "r-2", content: "# Fallback", createdAt: 2000 }] });
    const result = await getInvestigationFindings({ ...baseParams, type: "investigation" });
    expect(result.findings).toBe("# Fallback");
  });

  it("should return null findings when no records at all", async () => {
    mockListJournalRecords.mockResolvedValueOnce({ records: [] }).mockResolvedValueOnce({ records: [] });
    const result = await getInvestigationFindings({ ...baseParams, type: "investigation" });
    expect(result.findings).toBeNull();
  });

  it("should return 404 for mitigation type when no mitigation execution", async () => {
    mockListExecutions.mockResolvedValueOnce({ executions: [{ executionId: "exec-xyz", agentType: "investigation" }] });
    await expect(getInvestigationFindings({ ...baseParams, type: "mitigation" })).rejects.toMatchObject({ code: "MITIGATION_NOT_FOUND", statusCode: 404 });
  });

  it("should fetch mitigation findings from mitigation execution", async () => {
    mockListExecutions.mockResolvedValueOnce({ executions: [{ executionId: "exec-mit", agentType: "mitigation" }] });
    mockListJournalRecords.mockResolvedValueOnce({ records: [{ recordId: "r-3", recordType: "mitigation_summary_md", content: "# Fix", createdAt: 3000 }] });
    const result = await getInvestigationFindings({ ...baseParams, type: "mitigation" });
    expect(result.findings).toBe("# Fix");
  });

  it("should return 429 on ThrottlingException", async () => {
    const err = new Error("throttled"); err.name = "ThrottlingException";
    mockListJournalRecords.mockRejectedValueOnce(err);
    await expect(getInvestigationFindings({ ...baseParams, type: "investigation" })).rejects.toMatchObject({ code: "THROTTLED", statusCode: 429 });
  });
});

// ─── cancelInvestigation ─────────────────────────────────────────────

describe("cancelInvestigation", () => {
  it("should cancel and auto-archive", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS" });
    mockUpdateBacklogTask.mockResolvedValueOnce({ status: "CANCELED" });
    const result = await cancelInvestigation({ ...baseParams, body: { action: "cancel" } });
    expect(result).toEqual({ investigationId: "task-xyz", status: "CANCELED", archived: true });
    expect(mockUpdateBacklogTask).toHaveBeenCalledWith(expect.objectContaining({ taskStatus: "CANCELED" }));
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("should return 400 when action is missing", async () => {
    await expect(cancelInvestigation({ ...baseParams, body: {} })).rejects.toMatchObject({ code: "INVALID_ACTION", statusCode: 400 });
  });

  it("should return 400 when action is not cancel", async () => {
    await expect(cancelInvestigation({ ...baseParams, body: { action: "retry" } })).rejects.toMatchObject({ code: "INVALID_ACTION", statusCode: 400 });
  });

  it("should return 409 when already COMPLETED", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "COMPLETED" });
    await expect(cancelInvestigation({ ...baseParams, body: { action: "cancel" } })).rejects.toMatchObject({ code: "ALREADY_TERMINAL", statusCode: 409 });
  });

  it("should be idempotent when already CANCELED", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "CANCELED" });
    const result = await cancelInvestigation({ ...baseParams, body: { action: "cancel" } });
    expect(result.archived).toBe(true);
    expect(mockUpdateBacklogTask).not.toHaveBeenCalled();
  });

  it("should return 429 on ThrottlingException from UpdateBacklogTask", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS" });
    const err = new Error("throttled"); err.name = "ThrottlingException";
    mockUpdateBacklogTask.mockRejectedValueOnce(err);
    await expect(cancelInvestigation({ ...baseParams, body: { action: "cancel" } })).rejects.toMatchObject({ code: "THROTTLED", statusCode: 429 });
  });
});

// ─── archiveInvestigation ────────────────────────────────────────────

describe("archiveInvestigation", () => {
  it("should archive a COMPLETED investigation", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "COMPLETED" });
    const result = await archiveInvestigation(baseParams);
    expect(result.archived).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("should return 409 when non-terminal", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS" });
    await expect(archiveInvestigation(baseParams)).rejects.toMatchObject({ code: "NOT_TERMINAL", statusCode: 409 });
  });

  it("should be idempotent when already archived", async () => {
    mockGet.mockResolvedValueOnce({ Item: { ...mockInvestigation, archived: true } });
    const result = await archiveInvestigation(baseParams);
    expect(result.archived).toBe(true);
    expect(mockGetBacklogTask).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("should return 404 when investigation not found", async () => {
    mockGet.mockResolvedValueOnce({ Item: undefined });
    await expect(archiveInvestigation(baseParams)).rejects.toMatchObject({ code: "INVESTIGATION_NOT_FOUND", statusCode: 404 });
  });
});

// ─── getInvestigationFindings — format parameter ─────────────────────────────

describe("getInvestigationFindings — format parameter", () => {
  beforeEach(() => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
  });

  it("should request investigation_summary when format is structured", async () => {
    mockListJournalRecords.mockResolvedValueOnce({ records: [{ recordId: "r-1", recordType: "investigation_summary", content: "{}", createdAt: 1000 }] });
    const result = await getInvestigationFindings({ ...baseParams, type: "investigation", format: "structured" });
    expect(mockListJournalRecords).toHaveBeenCalledWith(expect.objectContaining({ recordType: "investigation_summary" }));
    expect(result.findings).toBe("{}");
  });

  it("should request investigation_summary_md when format is not structured", async () => {
    mockListJournalRecords.mockResolvedValueOnce({ records: [{ recordId: "r-1", recordType: "investigation_summary_md", content: "# RCA", createdAt: 1000 }] });
    const result = await getInvestigationFindings({ ...baseParams, type: "investigation", format: "markdown" });
    expect(mockListJournalRecords).toHaveBeenCalledWith(expect.objectContaining({ recordType: "investigation_summary_md" }));
    expect(result.findings).toBe("# RCA");
  });

  it("should request mitigation_summary when type=mitigation and format=structured", async () => {
    mockListExecutions.mockResolvedValueOnce({ executions: [{ executionId: "exec-mit", agentType: "mitigation" }] });
    mockListJournalRecords.mockResolvedValueOnce({ records: [{ recordId: "r-1", recordType: "mitigation_summary", content: "{}", createdAt: 1000 }] });
    const result = await getInvestigationFindings({ ...baseParams, type: "mitigation", format: "structured" });
    expect(mockListJournalRecords).toHaveBeenCalledWith(expect.objectContaining({ recordType: "mitigation_summary" }));
    expect(result.findings).toBe("{}");
  });

  it("should request mitigation_summary_md when type=mitigation and format=markdown", async () => {
    mockListExecutions.mockResolvedValueOnce({ executions: [{ executionId: "exec-mit", agentType: "mitigation" }] });
    mockListJournalRecords.mockResolvedValueOnce({ records: [{ recordId: "r-1", recordType: "mitigation_summary_md", content: "# Fix", createdAt: 1000 }] });
    const result = await getInvestigationFindings({ ...baseParams, type: "mitigation", format: "markdown" });
    expect(mockListJournalRecords).toHaveBeenCalledWith(expect.objectContaining({ recordType: "mitigation_summary_md" }));
    expect(result.findings).toBe("# Fix");
  });
});

// ─── createInvestigation — additional branch coverage ────────────────────────

describe("createInvestigation — priority and title branches", () => {
  it("should use provided valid priority", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation({ ...baseParams, body: { agentSpaceId: "as-123", priority: "CRITICAL" } });
    expect(mockCreateBacklogTask).toHaveBeenCalledWith(expect.objectContaining({ priority: "CRITICAL" }));
  });

  it("should default to HIGH when priority is invalid", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation({ ...baseParams, body: { agentSpaceId: "as-123", priority: "UNKNOWN" } });
    expect(mockCreateBacklogTask).toHaveBeenCalledWith(expect.objectContaining({ priority: "HIGH" }));
  });

  it("should build title with healthy indicator when fail=0", async () => {
    const healthyRun = { ...mockTestRun, results: JSON.stringify({ total: { fail: 0, succ: 1000 } }) };
    mockGet.mockResolvedValueOnce({ Item: healthyRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    const title = mockCreateBacklogTask.mock.calls[0][0].title;
    expect(title).toContain("healthy");
    expect(title).toContain("1000 req");
  });

  it("should build title indicating failure when run status is 'failed', even with a 0% request error rate", async () => {
    const failedRun = { ...mockTestRun, status: "failed", results: JSON.stringify({ total: { fail: 0, succ: 383 } }) };
    mockGet.mockResolvedValueOnce({ Item: failedRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    const title = mockCreateBacklogTask.mock.calls[0][0].title;
    expect(title).toContain("test run failed");
    expect(title).not.toContain("healthy");
  });

  it("should build title with fail rate when failures exist", async () => {
    const failedRun = { ...mockTestRun, results: JSON.stringify({ total: { fail: 200, succ: 800 } }) };
    mockGet.mockResolvedValueOnce({ Item: failedRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    const title = mockCreateBacklogTask.mock.calls[0][0].title;
    expect(title).toContain("20% failed");
    expect(title).toContain("1000 req");
  });

  it("should build fallback title when results are missing", async () => {
    const noResultsRun = { ...mockTestRun, results: null };
    mockGet.mockResolvedValueOnce({ Item: noResultsRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    const title = mockCreateBacklogTask.mock.calls[0][0].title;
    expect(title).toContain("investigation requested");
  });

  it("should build fallback title when results have no total field", async () => {
    const emptyResultsRun = { ...mockTestRun, results: JSON.stringify({ labels: [] }) };
    mockGet.mockResolvedValueOnce({ Item: emptyResultsRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    const title = mockCreateBacklogTask.mock.calls[0][0].title;
    expect(title).toContain("investigation requested");
  });

  it("should use testId when testName is missing", async () => {
    const noNameRun = { ...mockTestRun, testName: undefined };
    mockGet.mockResolvedValueOnce({ Item: noNameRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    const title = mockCreateBacklogTask.mock.calls[0][0].title;
    expect(title).toContain("test-abc");
  });

  it("should include testRunId in the title", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    const title = mockCreateBacklogTask.mock.calls[0][0].title;
    expect(title).toContain("[run-001");
    expect(title).toContain("2026-05-20 10:00:00 UTC");
  });

  it("should re-throw non-ConditionalCheckFailed errors from put", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const err = new Error("internal"); err.name = "InternalServerError";
    mockPut.mockRejectedValueOnce(err);
    await expect(createInvestigation(baseParams)).rejects.toThrow("internal");
  });

  it("should not crash when results is malformed JSON", async () => {
    const badRun = { ...mockTestRun, results: "not-valid-json{{{" };
    mockGet.mockResolvedValueOnce({ Item: badRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const result = await createInvestigation(baseParams);
    expect(result.investigationId).toBe("task-xyz");
    expect(mockCreateBacklogTask).toHaveBeenCalled();
  });

  it("should not crash when testScenario is malformed JSON", async () => {
    const badRun = { ...mockTestRun, testScenario: "not-valid-json{{{" };
    mockGet.mockResolvedValueOnce({ Item: badRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    const result = await createInvestigation(baseParams);
    expect(result.investigationId).toBe("task-xyz");
    expect(mockCreateBacklogTask).toHaveBeenCalled();
  });
});

// ─── getInvestigationStatus — agentSpaceId mismatch warning ──────────────────

describe("getInvestigationStatus — agentSpaceId mismatch", () => {
  it("should warn when task.agentSpaceId does not match", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS", agentSpaceId: "other-space" });
    await getInvestigationStatus(baseParams);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("agentSpaceMismatch"));
  });
});

// ─── Artifact compensation & lifecycle cleanup ───────────────────────────────

describe("investigation artifact cleanup", () => {
  // Configures S3 + createAsset so the create flow produces an artifact asset.
  const configureArtifactUploadSuccess = (assetId = "asset-xyz") => {
    const runFolder = "results/test-abc/20260520T100000_run-001/";
    mockS3Send.mockImplementation(async (command) => {
      if (command.__command === "list") {
        if (command.input.Delimiter === "/") return { CommonPrefixes: [{ Prefix: runFolder }] };
        return { Contents: [{ Key: `${runFolder}err.err`, Size: 50 }], IsTruncated: false };
      }
      if (command.__command === "get") return { Body: { transformToString: async () => "failure detail" } };
      throw new Error("unexpected command");
    });
    mockCreateAsset.mockResolvedValueOnce({ assetId });
  };

  it("deletes the uploaded artifact asset when task creation fails", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    configureArtifactUploadSuccess("asset-xyz");
    const err = new Error("boom"); err.name = "InternalServerException";
    mockCreateBacklogTask.mockRejectedValueOnce(err);

    await expect(createInvestigation(baseParams)).rejects.toBeDefined();
    expect(mockDeleteAsset).toHaveBeenCalledWith(expect.objectContaining({ agentSpaceId: "my-space", assetId: "asset-xyz" }));
  });

  it("cancels the orphaned task and deletes the asset when the record write fails", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    configureArtifactUploadSuccess("asset-xyz");
    // First put = lock acquire (succeeds); second put = record write (fails).
    mockPut.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("ddb down"));

    await expect(createInvestigation(baseParams)).rejects.toThrow("ddb down");
    expect(mockUpdateBacklogTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-xyz", taskStatus: "CANCELED" }));
    expect(mockDeleteAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: "asset-xyz" }));
  });

  it("still throws INVESTIGATION_ALREADY_EXISTS and cleans up on a conditional put failure", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    configureArtifactUploadSuccess("asset-xyz");
    const condErr = new Error("conditional"); condErr.name = "ConditionalCheckFailedException";
    // First put = lock acquire (succeeds); second put = record write (fails CCF).
    mockPut.mockResolvedValueOnce({}).mockRejectedValueOnce(condErr);

    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "INVESTIGATION_ALREADY_EXISTS", statusCode: 409 });
    expect(mockDeleteAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: "asset-xyz" }));
  });

  it("keeps the description within 10,000 chars when artifacts are uploaded", async () => {
    // 150 endpoints push the description right up to the cap; before the fix,
    // the artifacts section was appended after truncation and overflowed it.
    const endpoints = [];
    for (let i = 0; i < 150; i++) {
      endpoints.push({ label: `/api/endpoint-${i}-with-a-long-path-to-consume-characters`, avg_rt: "0.100", fail: i, succ: 100 });
    }
    const bigTestRun = { ...mockTestRun, results: JSON.stringify({ total: { avg_rt: "0.245", fail: 12, succ: 9988, labels: endpoints } }) };
    mockGet.mockResolvedValueOnce({ Item: bigTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    configureArtifactUploadSuccess("asset-xyz");

    await createInvestigation(baseParams);

    const { description } = mockCreateBacklogTask.mock.calls[0][0];
    expect(description.length).toBeLessThanOrEqual(10000);
    expect(description).toContain("Attached Artifacts");
    expect(description).toContain("Asset ID: asset-xyz");
  });

  it("does not attempt cleanup when no artifact was uploaded and task creation fails", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    // Default S3 returns no objects → no artifact → artifactResult is null.
    const err = new Error("boom"); err.name = "InternalServerException";
    mockCreateBacklogTask.mockRejectedValueOnce(err);

    await expect(createInvestigation(baseParams)).rejects.toBeDefined();
    expect(mockDeleteAsset).not.toHaveBeenCalled();
  });

  it("deletes the artifact asset when canceling an investigation that has one", async () => {
    mockGet.mockResolvedValueOnce({ Item: { ...mockInvestigation, artifactAssetId: "asset-abc" } });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS" });

    await cancelInvestigation({ ...baseParams, body: { action: "cancel" } });

    expect(mockDeleteAsset).toHaveBeenCalledWith(expect.objectContaining({ agentSpaceId: "my-space", assetId: "asset-abc" }));
  });

  it("deletes the artifact asset when archiving an investigation that has one", async () => {
    mockGet.mockResolvedValueOnce({ Item: { ...mockInvestigation, artifactAssetId: "asset-abc" } });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "COMPLETED" });

    await archiveInvestigation(baseParams);

    expect(mockDeleteAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: "asset-abc" }));
  });

  it("does not fail archive when artifact asset deletion fails", async () => {
    mockGet.mockResolvedValueOnce({ Item: { ...mockInvestigation, artifactAssetId: "asset-abc" } });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "COMPLETED" });
    mockDeleteAsset.mockRejectedValueOnce(new Error("delete failed"));

    const result = await archiveInvestigation(baseParams);

    expect(result).toEqual({ investigationId: "task-xyz", archived: true });
  });

  it("does not call deleteAsset when a canceled investigation has no artifact", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS" });

    await cancelInvestigation({ ...baseParams, body: { action: "cancel" } });

    expect(mockDeleteAsset).not.toHaveBeenCalled();
  });
});

// ─── Active-investigation lock ───────────────────────────────────────────────

describe("active investigation lock", () => {
  const lockKey = { testId: "test-abc", "testRunId#investigationId": "ACTIVE#run-001" };

  const configureArtifactUploadSuccess = (assetId = "asset-xyz") => {
    const runFolder = "results/test-abc/20260520T100000_run-001/";
    mockS3Send.mockImplementation(async (command) => {
      if (command.__command === "list") {
        if (command.input.Delimiter === "/") return { CommonPrefixes: [{ Prefix: runFolder }] };
        return { Contents: [{ Key: `${runFolder}err.err`, Size: 50 }], IsTruncated: false };
      }
      if (command.__command === "get") return { Body: { transformToString: async () => "failure detail" } };
      throw new Error("unexpected command");
    });
    mockCreateAsset.mockResolvedValueOnce({ assetId });
  };

  it("rejects with INVESTIGATION_ALREADY_EXISTS and does no work when the lock is held", async () => {
    mockGet
      .mockResolvedValueOnce({ Item: mockTestRun })
      .mockResolvedValueOnce({ Item: mockAgentSpace })
      .mockResolvedValueOnce({ Item: {} }) // scenario (no baseline)
      .mockResolvedValueOnce({ Item: { createdAt: new Date().toISOString() } }); // fresh lock held
    const condErr = new Error("locked"); condErr.name = "ConditionalCheckFailedException";
    mockPut.mockRejectedValueOnce(condErr); // lock acquire fails

    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "INVESTIGATION_ALREADY_EXISTS", statusCode: 409 });
    expect(mockCreateBacklogTask).not.toHaveBeenCalled();
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it("acquires the lock with a conditional put on the ACTIVE marker key", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining(lockKey),
      ConditionExpression: "attribute_not_exists(testId)",
    }));
  });

  it("releases the lock when task creation fails", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    configureArtifactUploadSuccess();
    const err = new Error("boom"); err.name = "InternalServerException";
    mockCreateBacklogTask.mockRejectedValueOnce(err);

    await expect(createInvestigation(baseParams)).rejects.toBeDefined();
    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({ Key: lockKey }));
  });

  it("releases the lock when the record write fails", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    configureArtifactUploadSuccess();
    mockPut.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("ddb down")); // lock ok, record fails

    await expect(createInvestigation(baseParams)).rejects.toThrow("ddb down");
    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({ Key: lockKey }));
  });

  it("does not release the lock on a successful create", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockTestRun }).mockResolvedValueOnce({ Item: mockAgentSpace });
    await createInvestigation(baseParams);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("releases the lock when canceling an investigation", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "IN_PROGRESS" });

    await cancelInvestigation({ ...baseParams, body: { action: "cancel" } });

    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({ Key: lockKey }));
  });

  it("releases the lock when archiving an investigation", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "COMPLETED" });

    await archiveInvestigation(baseParams);

    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({ Key: lockKey }));
  });

  it("does not fail the request when lock release fails", async () => {
    mockGet.mockResolvedValueOnce({ Item: mockInvestigation });
    mockGetBacklogTask.mockResolvedValueOnce({ status: "COMPLETED" });
    mockDelete.mockRejectedValueOnce(new Error("delete failed"));

    const result = await archiveInvestigation(baseParams);

    expect(result).toEqual({ investigationId: "task-xyz", archived: true });
  });

  it("reclaims a stale lock and proceeds with the create", async () => {
    const staleCreatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min old
    mockGet
      .mockResolvedValueOnce({ Item: mockTestRun })
      .mockResolvedValueOnce({ Item: mockAgentSpace })
      .mockResolvedValueOnce({ Item: { createdAt: staleCreatedAt } }); // stale lock
    const condErr = new Error("locked"); condErr.name = "ConditionalCheckFailedException";
    // First lock put fails (lock exists); reclaim delete succeeds; second lock put succeeds; record put succeeds.
    mockPut.mockRejectedValueOnce(condErr).mockResolvedValue({});

    const result = await createInvestigation(baseParams);

    expect(result.investigationId).toBe("task-xyz");
    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({
      Key: lockKey,
      ConditionExpression: "#c = :c",
    }));
    expect(mockCreateBacklogTask).toHaveBeenCalled();
  });

  it("rejects when a stale lock is reclaimed concurrently (guarded delete fails)", async () => {
    const staleCreatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockGet
      .mockResolvedValueOnce({ Item: mockTestRun })
      .mockResolvedValueOnce({ Item: mockAgentSpace })
      .mockResolvedValueOnce({ Item: { createdAt: staleCreatedAt } });
    const condErr = new Error("locked"); condErr.name = "ConditionalCheckFailedException";
    mockPut.mockRejectedValueOnce(condErr); // lock acquire fails
    mockDelete.mockRejectedValueOnce(Object.assign(new Error("guard"), { name: "ConditionalCheckFailedException" }));

    await expect(createInvestigation(baseParams)).rejects.toMatchObject({ code: "INVESTIGATION_ALREADY_EXISTS", statusCode: 409 });
    expect(mockCreateBacklogTask).not.toHaveBeenCalled();
  });
});
