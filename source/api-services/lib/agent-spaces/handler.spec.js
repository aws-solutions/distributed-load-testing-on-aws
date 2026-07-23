// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.AWS_REGION = "us-east-1";
process.env.AGENT_SPACES_TABLE = "TestAgentSpacesTable";
process.env.AWS_ACCOUNT_ID = "123456789012";
process.env.SCENARIOS_TABLE = "TestScenariosTable";
process.env.HISTORY_TABLE = "TestHistoryTable";
process.env.HISTORY_TABLE_GSI_NAME = "TestGSI";
process.env.INVESTIGATIONS_TABLE = "TestInvestigationsTable";

const mockDynamoDB = {
  scan: jest.fn(),
  put: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  batchGet: jest.fn(),
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

const mockGetAgentSpace = jest.fn();
jest.mock("../integrations/aidevops/client", () => ({
  getAgentSpace: mockGetAgentSpace,
  createBacklogTask: jest.fn(),
  getBacklogTask: jest.fn(),
  updateBacklogTask: jest.fn(),
  listExecutions: jest.fn(),
  listJournalRecords: jest.fn(),
}));
jest.mock("../investigations/", () => ({
  createInvestigation: jest.fn(),
  listInvestigations: jest.fn(),
  getInvestigationStatus: jest.fn(),
  getInvestigationFindings: jest.fn(),
  cancelInvestigation: jest.fn(),
  archiveInvestigation: jest.fn(),
}));

const { handler } = require("../../index");

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

const context = { awsRequestId: "test-req", functionName: "test-fn", invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test-fn" };

function parse(response) {
  return { status: response.statusCode, data: JSON.parse(response.body) };
}

const VALID_ARN = "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space-001";

// Realistic SDK response shapes captured from TASK-W01 fixtures
const GET_AGENT_SPACE_SUCCESS = {
  agentSpace: {
    name: "my-agent-space",
    locale: "en-US",
    createdAt: "2026-05-18T20:29:36.020000+00:00",
    updatedAt: "2026-05-18T20:29:36.020000+00:00",
    agentSpaceId: "my-space-001",
  },
  tags: {},
  $metadata: { httpStatusCode: 200, requestId: "req-abc123" },
};

function sdkError(name, message) {
  const err = new Error(message);
  err.name = name;
  err.$metadata = { httpStatusCode: name === "ResourceNotFoundException" ? 404 : 403 };
  err.$fault = "client";
  return err;
}

describe("Agent Spaces API — full handler integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoDB.scan.mockResolvedValue({ Items: [] });
    mockDynamoDB.put.mockResolvedValue({});
    mockDynamoDB.update.mockResolvedValue({ Attributes: {} });
    mockDynamoDB.delete.mockResolvedValue({});
  });

  // ─── GET /agent-spaces ──────────────────────────────────────────────────────

  describe("GET /agent-spaces", () => {
    it("returns empty array", async () => {
      const { status, data } = parse(await handler(apiEvent("/agent-spaces", "GET"), context));
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it("returns all agent spaces with pagination", async () => {
      mockDynamoDB.scan
        .mockResolvedValueOnce({ Items: [{ id: "1", displayName: "A" }], LastEvaluatedKey: { id: "1" } })
        .mockResolvedValueOnce({ Items: [{ id: "2", displayName: "B" }] });

      const { status, data } = parse(await handler(apiEvent("/agent-spaces", "GET"), context));
      expect(status).toBe(200);
      expect(data).toHaveLength(2);
      expect(mockDynamoDB.scan).toHaveBeenCalledTimes(2);
    });
  });

  // ─── POST /agent-spaces ─────────────────────────────────────────────────────

  describe("POST /agent-spaces", () => {
    it("registers a valid agent space", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "My Space", agentSpaceArn: VALID_ARN } }), context
      ));
      expect(status).toBe(200);
      expect(data.displayName).toBe("My Space");
      expect(data.agentSpaceArn).toBe(VALID_ARN);
      expect(data.id).toBeDefined();
      expect(data.createdAt).toBeDefined();
      expect(mockDynamoDB.put).toHaveBeenCalledTimes(1);
    });

    it("rejects missing displayName", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { agentSpaceArn: VALID_ARN } }), context
      ));
      expect(status).toBe(400);
      expect(data).toContain("displayName");
    });

    it("rejects missing agentSpaceArn", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "Test" } }), context
      ));
      expect(status).toBe(400);
      expect(data).toContain("agentSpaceArn");
    });

    it("rejects invalid ARN format", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "Test", agentSpaceArn: "arn:aws:s3:::bucket" } }), context
      ));
      expect(status).toBe(400);
      expect(data).toContain("must match format");
    });

    it("rejects cross-account ARN", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "Test", agentSpaceArn: "arn:aws:aidevops:us-east-1:999999999999:agentspace/x" } }), context
      ));
      expect(status).toBe(400);
      expect(data).toContain("same AWS account");
    });

    it("rejects duplicate ARN", async () => {
      mockDynamoDB.scan.mockResolvedValue({ Items: [{ id: "existing", agentSpaceArn: VALID_ARN }] });
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "Test", agentSpaceArn: VALID_ARN } }), context
      ));
      expect(status).toBe(409);
      expect(data).toContain("already registered");
    });

    it("rejects displayName > 64 chars", async () => {
      const { status } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "a".repeat(65), agentSpaceArn: VALID_ARN } }), context
      ));
      expect(status).toBe(400);
    });

    it("rejects whitespace-only displayName", async () => {
      const { status } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "   ", agentSpaceArn: VALID_ARN } }), context
      ));
      expect(status).toBe(400);
    });

    it("trims displayName", async () => {
      const { data } = parse(await handler(
        apiEvent("/agent-spaces", "POST", { body: { displayName: "  trimmed  ", agentSpaceArn: VALID_ARN } }), context
      ));
      expect(data.displayName).toBe("trimmed");
    });
  });

  // ─── PUT /agent-spaces/{id} ─────────────────────────────────────────────────

  describe("PUT /agent-spaces/{id}", () => {
    it("updates displayName", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: { id: "id-1", displayName: "Old", agentSpaceArn: VALID_ARN } });
      mockDynamoDB.update.mockResolvedValue({ Attributes: { id: "id-1", displayName: "New" } });

      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/{id}", "PUT", { body: { displayName: "New" }, pathParameters: { id: "id-1" } }), context
      ));
      expect(status).toBe(200);
      expect(data.displayName).toBe("New");
    });

    it("returns 404 for missing id", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: undefined });
      const { status } = parse(await handler(
        apiEvent("/agent-spaces/{id}", "PUT", { body: { displayName: "X" }, pathParameters: { id: "nope" } }), context
      ));
      expect(status).toBe(404);
    });

    it("rejects missing displayName", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/{id}", "PUT", { body: {}, pathParameters: { id: "id-1" } }), context
      ));
      expect(status).toBe(400);
      expect(data).toContain("displayName is required");
    });

    it("rejects whitespace-only displayName", async () => {
      const { status } = parse(await handler(
        apiEvent("/agent-spaces/{id}", "PUT", { body: { displayName: "   " }, pathParameters: { id: "id-1" } }), context
      ));
      expect(status).toBe(400);
    });
  });

  // ─── DELETE /agent-spaces/{id} ──────────────────────────────────────────────

  describe("DELETE /agent-spaces/{id}", () => {
    it("removes an existing agent space", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: { id: "id-1" } });
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/{id}", "DELETE", { pathParameters: { id: "id-1" } }), context
      ));
      expect(status).toBe(200);
      expect(data.message).toBe("Agent Space removed");
      expect(mockDynamoDB.delete).toHaveBeenCalledTimes(1);
    });

    it("returns 404 for missing id", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: undefined });
      const { status } = parse(await handler(
        apiEvent("/agent-spaces/{id}", "DELETE", { pathParameters: { id: "nope" } }), context
      ));
      expect(status).toBe(404);
    });
  });

  // ─── POST /agent-spaces/test-connection ─────────────────────────────────────

  describe("POST /agent-spaces/test-connection", () => {
    it("tests by agentSpaceIds — success", async () => {
      mockDynamoDB.batchGet.mockResolvedValue({ Responses: { TestAgentSpacesTable: [{ id: "id-1", agentSpaceArn: VALID_ARN }] } });
      mockDynamoDB.update.mockResolvedValue({});
      mockGetAgentSpace.mockResolvedValue(GET_AGENT_SPACE_SUCCESS);

      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/test-connection", "POST", { body: { agentSpaceIds: ["id-1"] } }), context
      ));
      expect(status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].status).toBe("connected");
      expect(data[0].id).toBe("id-1");
    });

    it("tests by agentSpaceArns — success", async () => {
      mockGetAgentSpace.mockResolvedValue(GET_AGENT_SPACE_SUCCESS);

      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/test-connection", "POST", { body: { agentSpaceArns: [VALID_ARN] } }), context
      ));
      expect(status).toBe(200);
      expect(data[0].status).toBe("connected");
      expect(data[0].id).toBeNull();
    });

    it("returns error for non-existent id", async () => {
      mockDynamoDB.batchGet.mockResolvedValue({ Responses: { TestAgentSpacesTable: [] } });

      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/test-connection", "POST", { body: { agentSpaceIds: ["missing"] } }), context
      ));
      expect(status).toBe(200);
      expect(data[0].status).toBe("error");
    });

    it("returns error on ResourceNotFoundException", async () => {
      mockGetAgentSpace.mockRejectedValue(
        sdkError("ResourceNotFoundException", "AgentSpace with agentSpaceId my-space-001 not found.")
      );

      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/test-connection", "POST", { body: { agentSpaceArns: [VALID_ARN] } }), context
      ));
      expect(status).toBe(200);
      expect(data[0].status).toBe("error");
      expect(data[0].message).toContain("not found");
    });

    it("returns error on AccessDeniedException", async () => {
      mockGetAgentSpace.mockRejectedValue(
        sdkError("AccessDeniedException", "Agent space not found")
      );

      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/test-connection", "POST", { body: { agentSpaceArns: [VALID_ARN] } }), context
      ));
      expect(status).toBe(200);
      expect(data[0].status).toBe("error");
      expect(data[0].message).toContain("Access denied");
    });

    it("rejects invalid ARN in agentSpaceArns", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/test-connection", "POST", { body: { agentSpaceArns: ["bad-arn"] } }), context
      ));
      expect(status).toBe(400);
      expect(data).toContain("must match format");
    });

    it("rejects empty body", async () => {
      const { status, data } = parse(await handler(
        apiEvent("/agent-spaces/test-connection", "POST", { body: {} }), context
      ));
      expect(status).toBe(400);
      expect(data).toContain("At least one of");
    });
  });

  // ─── Method not allowed ─────────────────────────────────────────────────────

  describe("method not allowed", () => {
    it("rejects DELETE on /agent-spaces", async () => {
      const { status } = parse(await handler(apiEvent("/agent-spaces", "DELETE"), context));
      expect(status).toBe(405);
    });

    it("rejects GET on /agent-spaces/test-connection", async () => {
      const { status } = parse(await handler(apiEvent("/agent-spaces/test-connection", "GET"), context));
      expect(status).toBe(405);
    });

    it("rejects POST on /agent-spaces/{id}", async () => {
      const { status } = parse(await handler(
        apiEvent("/agent-spaces/{id}", "POST", { pathParameters: { id: "x" } }), context
      ));
      expect(status).toBe(405);
    });
  });
});
