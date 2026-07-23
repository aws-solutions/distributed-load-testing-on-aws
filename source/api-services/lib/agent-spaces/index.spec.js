// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.AWS_REGION = "us-east-1";
process.env.AGENT_SPACES_TABLE = "TestAgentSpacesTable";
process.env.AWS_ACCOUNT_ID = "123456789012";

const mockDynamoDB = {
  scan: jest.fn(),
  put: jest.fn(),
  get: jest.fn(),
  batchGet: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: { from: jest.fn(() => mockDynamoDB) },
}));

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDB: jest.fn(),
}));

jest.mock("solution-utils", () => ({
  getOptions: jest.fn((opts) => opts || {}),
}));

jest.mock("../constants", () => {
  class ErrorException extends Error {
    constructor(code, errMsg, statusCode = 400) {
      super(errMsg);
      this.code = code;
      this.message = errMsg;
      this.statusCode = statusCode;
    }
    toString() {
      return `${this.code}: ${this.message}`;
    }
  }
  return {
    ErrorException,
    StatusCodes: {
      OK: 200,
      BAD_REQUEST: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      NOT_ALLOWED: 405,
      CONFLICT: 409,
      REQUEST_TOO_LONG: 413,
      INTERNAL_SERVER_ERROR: 500,
      TIMEOUT: 503,
    },
  };
});

const mockGetAgentSpace = jest.fn();
jest.mock("../integrations/aidevops/client", () => ({
  getAgentSpace: mockGetAgentSpace,
}));

const {
  listAgentSpaces,
  registerAgentSpace,
  updateAgentSpace,
  deregisterAgentSpace,
  testConnection,
} = require("./index");

describe("agent-spaces handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listAgentSpaces", () => {
    it("returns all agent spaces from DynamoDB", async () => {
      const items = [
        { id: "1", displayName: "Space 1", agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/space-1" },
        { id: "2", displayName: "Space 2", agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/space-2" },
      ];
      mockDynamoDB.scan.mockResolvedValue({ Items: items });

      const result = await listAgentSpaces();

      expect(result).toEqual(items);
      expect(mockDynamoDB.scan).toHaveBeenCalledWith({ TableName: "TestAgentSpacesTable" });
    });

    it("returns empty array when no items exist", async () => {
      mockDynamoDB.scan.mockResolvedValue({ Items: undefined });

      const result = await listAgentSpaces();

      expect(result).toEqual([]);
    });
  });

  describe("registerAgentSpace", () => {
    beforeEach(() => {
      mockDynamoDB.scan.mockResolvedValue({ Count: 0 });
      mockDynamoDB.put.mockResolvedValue({});
    });

    it("creates an agent space with valid inputs", async () => {
      const body = {
        displayName: "My Agent Space",
        agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space",
      };

      const result = await registerAgentSpace(body);

      expect(result.displayName).toBe("My Agent Space");
      expect(result.agentSpaceArn).toBe(body.agentSpaceArn);
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(mockDynamoDB.put).toHaveBeenCalledTimes(1);
    });

    it("rejects missing displayName", async () => {
      await expect(registerAgentSpace({ agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/x" }))
        .rejects.toThrow("displayName is required");
    });

    it("rejects displayName longer than 64 characters", async () => {
      const body = {
        displayName: "a".repeat(65),
        agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/x",
      };

      await expect(registerAgentSpace(body)).rejects.toThrow("64 characters or fewer");
    });

    it("rejects missing agentSpaceArn", async () => {
      await expect(registerAgentSpace({ displayName: "Test" })).rejects.toThrow("agentSpaceArn is required");
    });

    it("rejects invalid ARN format", async () => {
      const body = {
        displayName: "Test",
        agentSpaceArn: "arn:aws:s3:::my-bucket",
      };

      await expect(registerAgentSpace(body)).rejects.toThrow("must match format");
    });

    it("rejects cross-account ARN", async () => {
      const body = {
        displayName: "Test",
        agentSpaceArn: "arn:aws:aidevops:us-east-1:999999999999:agentspace/other-space",
      };

      await expect(registerAgentSpace(body)).rejects.toThrow("same AWS account");
    });

    it("rejects duplicate ARN", async () => {
      mockDynamoDB.scan.mockResolvedValue({
        Items: [{ id: "existing-id", agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/space-1" }],
      });

      const body = {
        displayName: "Test",
        agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/space-1",
      };

      await expect(registerAgentSpace(body)).rejects.toThrow("already registered");
    });

    it("trims whitespace from displayName", async () => {
      const body = {
        displayName: "  Space Name  ",
        agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/x",
      };

      const result = await registerAgentSpace(body);

      expect(result.displayName).toBe("Space Name");
    });
  });

  describe("updateAgentSpace", () => {
    const existingItem = {
      id: "abc-123",
      displayName: "Old Name",
      agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/old-space",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    beforeEach(() => {
      mockDynamoDB.get.mockResolvedValue({ Item: existingItem });
      mockDynamoDB.update.mockResolvedValue({ Attributes: { ...existingItem, displayName: "New Name" } });
    });

    it("updates displayName", async () => {
      const result = await updateAgentSpace("abc-123", { displayName: "New Name" });

      expect(result.displayName).toBe("New Name");
      expect(mockDynamoDB.update).toHaveBeenCalledTimes(1);
    });

    it("returns 404 for non-existent id", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: undefined });

      await expect(updateAgentSpace("missing-id", { displayName: "X" })).rejects.toThrow("not found");
    });

    it("rejects when displayName is missing", async () => {
      await expect(updateAgentSpace("abc-123", {})).rejects.toThrow("displayName is required");
    });

    it("rejects whitespace-only displayName", async () => {
      await expect(updateAgentSpace("abc-123", { displayName: "   " })).rejects.toThrow("non-empty string");
    });

    it("rejects displayName longer than 64 characters", async () => {
      await expect(
        updateAgentSpace("abc-123", { displayName: "a".repeat(65) })
      ).rejects.toThrow("64 characters or fewer");
    });
  });

  describe("deregisterAgentSpace", () => {
    it("deletes an existing agent space", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: { id: "abc-123" } });
      mockDynamoDB.delete.mockResolvedValue({});

      const result = await deregisterAgentSpace("abc-123");

      expect(result.message).toBe("Agent Space removed");
      expect(mockDynamoDB.delete).toHaveBeenCalledWith({
        TableName: "TestAgentSpacesTable",
        Key: { id: "abc-123" },
      });
    });

    it("returns 404 for non-existent id", async () => {
      mockDynamoDB.get.mockResolvedValue({ Item: undefined });

      await expect(deregisterAgentSpace("missing-id")).rejects.toThrow("not found");
    });
  });

  describe("testConnection (batch)", () => {
    const existingItem = {
      id: "abc-123",
      displayName: "My Space",
      agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space",
    };

    beforeEach(() => {
      mockDynamoDB.batchGet.mockResolvedValue({
        Responses: { TestAgentSpacesTable: [existingItem] },
      });
      mockDynamoDB.update.mockResolvedValue({});
    });

    it("tests connection by agentSpaceIds", async () => {
      mockGetAgentSpace.mockResolvedValue({ agentSpaceId: "my-space", status: "ACTIVE" });

      const results = await testConnection({ agentSpaceIds: ["abc-123"] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("abc-123");
      expect(results[0].agentSpaceArn).toBe(existingItem.agentSpaceArn);
      expect(results[0].status).toBe("connected");
      expect(results[0].verifiedAt).toBeDefined();
      expect(mockGetAgentSpace).toHaveBeenCalledWith({ agentSpaceId: "my-space", region: "us-east-1", correlationId: undefined });
      expect(mockDynamoDB.update).toHaveBeenCalledTimes(1);
    });

    it("tests connection by agentSpaceArns", async () => {
      mockGetAgentSpace.mockResolvedValue({ agentSpaceId: "direct-space", status: "ACTIVE" });
      const arn = "arn:aws:aidevops:us-east-1:123456789012:agentspace/direct-space";

      const results = await testConnection({ agentSpaceArns: [arn] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBeNull();
      expect(results[0].agentSpaceArn).toBe(arn);
      expect(results[0].status).toBe("connected");
      expect(mockDynamoDB.update).not.toHaveBeenCalled();
    });

    it("returns error for non-existent id in agentSpaceIds", async () => {
      mockDynamoDB.batchGet.mockResolvedValue({
        Responses: { TestAgentSpacesTable: [] },
      });

      const results = await testConnection({ agentSpaceIds: ["missing-id"] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("missing-id");
      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("not found");
      expect(mockGetAgentSpace).not.toHaveBeenCalled();
    });

    it("returns error with helpful message on ResourceNotFoundException", async () => {
      const error = new Error("Not found");
      error.name = "ResourceNotFoundException";
      mockGetAgentSpace.mockRejectedValue(error);

      const results = await testConnection({ agentSpaceIds: ["abc-123"] });

      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("not found");
    });

    it("returns error with helpful message on AccessDeniedException", async () => {
      const error = new Error("Denied");
      error.name = "AccessDeniedException";
      mockGetAgentSpace.mockRejectedValue(error);

      const results = await testConnection({ agentSpaceIds: ["abc-123"] });

      expect(results[0].status).toBe("error");
      expect(results[0].message).toContain("Access denied");
    });

    it("updates connectionVerifiedAt and connectionVerifiedArn for registered ids", async () => {
      mockGetAgentSpace.mockResolvedValue({ agentSpaceId: "my-space" });

      await testConnection({ agentSpaceIds: ["abc-123"] });

      const updateCall = mockDynamoDB.update.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[":cva"]).toBe(existingItem.agentSpaceArn);
    });

    it("handles mixed ids and arns in one request", async () => {
      mockGetAgentSpace.mockResolvedValue({ status: "ACTIVE" });
      const arn = "arn:aws:aidevops:us-east-1:123456789012:agentspace/other-space";

      const results = await testConnection({
        agentSpaceIds: ["abc-123"],
        agentSpaceArns: [arn],
      });

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("abc-123");
      expect(results[1].id).toBeNull();
      expect(results[1].agentSpaceArn).toBe(arn);
    });

    it("rejects when neither agentSpaceArns nor agentSpaceIds provided", async () => {
      await expect(testConnection({})).rejects.toThrow("At least one of");
    });
  });
});
