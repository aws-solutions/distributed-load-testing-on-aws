// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.AWS_REGION = "us-east-1";

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-devops-agent", () => {
  return {
    DevOpsAgentClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    GetAgentSpaceCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "GetAgentSpace" })),
    CreateBacklogTaskCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "CreateBacklogTask" })),
    GetBacklogTaskCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "GetBacklogTask" })),
    UpdateBacklogTaskCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "UpdateBacklogTask" })),
    ListExecutionsCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "ListExecutions" })),
    ListJournalRecordsCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "ListJournalRecords" })),
    CreateAssetCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "CreateAsset" })),
    DeleteAssetCommand: jest.fn().mockImplementation((input) => ({ input, _commandName: "DeleteAsset" })),
  };
});

jest.mock("solution-utils", () => ({
  getOptions: jest.fn().mockReturnValue({ region: "us-east-1" }),
}));

jest.mock("./retry", () => {
  const original = jest.requireActual("./retry");
  // Replace sleep with instant resolution so retries don't block tests
  original.internals.sleep = jest.fn().mockResolvedValue(undefined);
  return original;
});

const { createBacklogTask, getBacklogTask, updateBacklogTask, listExecutions, listJournalRecords, createAsset, deleteAsset, getAgentSpace } = require("./client");

describe("aidevops client wrapper", () => {
  let consoleSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const baseInput = {
    correlationId: "test-corr-123",
    requesterCognitoSub: "user-sub-456",
  };

  // ─── createBacklogTask ───────────────────────────────────────────────────────

  describe("createBacklogTask", () => {
    it("should unwrap the task envelope and return flat fields", async () => {
      const taskPayload = {
        taskId: "task-001",
        executionId: "exec-001",
        status: "PENDING_TRIAGE",
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space",
      };
      mockSend.mockResolvedValueOnce({ task: taskPayload });

      const result = await createBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space",
        title: "Test failure",
        description: "Performance degradation detected",
        taskType: "INVESTIGATION",
        priority: "HIGH",
        clientToken: "token-abc",
      });

      expect(result).toEqual(taskPayload);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should NOT pass correlationId or requesterCognitoSub to the SDK command", async () => {
      mockSend.mockResolvedValueOnce({ task: { taskId: "t1" } });

      await createBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        title: "title",
        description: "desc",
        taskType: "INVESTIGATION",
        priority: "HIGH",
        clientToken: "ct",
      });

      const { CreateBacklogTaskCommand } = require("@aws-sdk/client-devops-agent");
      const commandInput = CreateBacklogTaskCommand.mock.calls[0][0];
      expect(commandInput).not.toHaveProperty("correlationId");
      expect(commandInput).not.toHaveProperty("requesterCognitoSub");
      expect(commandInput).toHaveProperty("agentSpaceId");
      expect(commandInput).toHaveProperty("title");
    });

    it("should emit a success log with correlation id and latency", async () => {
      mockSend.mockResolvedValueOnce({ task: { taskId: "t1" } });

      await createBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        title: "t",
        description: "d",
        taskType: "INVESTIGATION",
        priority: "HIGH",
        clientToken: "ct",
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe("info");
      expect(logEntry.action).toBe("aidevops.CreateBacklogTask");
      expect(logEntry.correlationId).toBe("test-corr-123");
      expect(logEntry.outcome).toBe("success");
      expect(logEntry.requesterCognitoSub).toBe("user-sub-456");
      expect(typeof logEntry.latencyMs).toBe("number");
    });

    it("should emit a log without requesterCognitoSub when not provided", async () => {
      mockSend.mockResolvedValueOnce({ task: { taskId: "t1" } });

      await createBacklogTask({
        correlationId: "corr-no-sub",
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        title: "t",
        description: "d",
        taskType: "INVESTIGATION",
        priority: "HIGH",
        clientToken: "ct",
      });

      const logEntry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logEntry).not.toHaveProperty("requesterCognitoSub");
      expect(logEntry).not.toHaveProperty("errorName");
    });

    it("should emit a failure log on error", async () => {
      const err = new Error("forbidden");
      err.name = "AccessDeniedException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("forbidden");

      const logEntry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logEntry.level).toBe("error");
      expect(logEntry.outcome).toBe("failure");
      expect(logEntry.errorName).toBe("AccessDeniedException");
    });

    it("should retry on ThrottlingException and eventually succeed", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const taskPayload = { taskId: "t-retry", executionId: "e-retry" };

      mockSend
        .mockRejectedValueOnce(throttleErr)
        .mockRejectedValueOnce(throttleErr)
        .mockResolvedValueOnce({ task: taskPayload });

      const result = await createBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        title: "t",
        description: "d",
        taskType: "INVESTIGATION",
        priority: "HIGH",
        clientToken: "ct",
      });

      expect(result).toEqual(taskPayload);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("should throw immediately on non-retryable errors (ValidationException)", async () => {
      const validationErr = new Error("invalid input");
      validationErr.name = "ValidationException";
      mockSend.mockRejectedValueOnce(validationErr);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("invalid input");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should throw after exhausting retries on persistent ThrottlingException", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      mockSend.mockRejectedValue(throttleErr);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("throttled");

      // 1 initial + 3 retries = 4 total attempts
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it("should throw immediately on AccessDeniedException", async () => {
      const err = new Error("access denied");
      err.name = "AccessDeniedException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("access denied");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately on ResourceNotFoundException", async () => {
      const err = new Error("not found");
      err.name = "ResourceNotFoundException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("not found");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately on ConflictException", async () => {
      const err = new Error("conflict");
      err.name = "ConflictException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("conflict");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately on ServiceQuotaExceededException", async () => {
      const err = new Error("quota exceeded");
      err.name = "ServiceQuotaExceededException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("quota exceeded");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately on ContentSizeExceededException", async () => {
      const err = new Error("content too large");
      err.name = "ContentSizeExceededException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        createBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          title: "t",
          description: "d",
          taskType: "INVESTIGATION",
          priority: "HIGH",
          clientToken: "ct",
        }),
      ).rejects.toThrow("content too large");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should retry on InternalServerException", async () => {
      const serverErr = new Error("internal error");
      serverErr.name = "InternalServerException";
      const taskPayload = { taskId: "t-ise" };

      mockSend.mockRejectedValueOnce(serverErr).mockResolvedValueOnce({ task: taskPayload });

      const result = await createBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        title: "t",
        description: "d",
        taskType: "INVESTIGATION",
        priority: "HIGH",
        clientToken: "ct",
      });

      expect(result).toEqual(taskPayload);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getBacklogTask ──────────────────────────────────────────────────────────

  describe("getBacklogTask", () => {
    it("should unwrap the task envelope and return flat fields", async () => {
      const taskPayload = { taskId: "t-get", status: "IN_PROGRESS", agentSpaceId: "arn:..." };
      mockSend.mockResolvedValueOnce({ task: taskPayload });

      const result = await getBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        taskId: "t-get",
      });

      expect(result).toEqual(taskPayload);
    });

    it("should emit log with investigationId field set to taskId", async () => {
      mockSend.mockResolvedValueOnce({ task: { taskId: "t-get", status: "COMPLETED" } });

      await getBacklogTask({
        ...baseInput,
        agentSpaceId: "s1",
        taskId: "inv-123",
      });

      const logEntry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logEntry.investigationId).toBe("inv-123");
      expect(logEntry.agentSpaceId).toBe("s1");
    });

    it("should retry on ThrottlingException and succeed", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const taskPayload = { taskId: "t-get", status: "COMPLETED" };

      mockSend.mockRejectedValueOnce(throttleErr).mockResolvedValueOnce({ task: taskPayload });

      const result = await getBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        taskId: "t-get",
      });

      expect(result).toEqual(taskPayload);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should throw immediately on ResourceNotFoundException", async () => {
      const err = new Error("task not found");
      err.name = "ResourceNotFoundException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        getBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          taskId: "t-missing",
        }),
      ).rejects.toThrow("task not found");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  // ─── updateBacklogTask ───────────────────────────────────────────────────────

  describe("updateBacklogTask", () => {
    it("should unwrap the task envelope on cancel", async () => {
      const taskPayload = { taskId: "t-cancel", status: "CANCELED" };
      mockSend.mockResolvedValueOnce({ task: taskPayload });

      const result = await updateBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        taskId: "t-cancel",
        taskStatus: "CANCELED",
      });

      expect(result).toEqual(taskPayload);
    });

    it("should retry on InternalServerException", async () => {
      const serverErr = new Error("internal");
      serverErr.name = "InternalServerException";
      const taskPayload = { taskId: "t-u", status: "CANCELED" };

      mockSend.mockRejectedValueOnce(serverErr).mockResolvedValueOnce({ task: taskPayload });

      const result = await updateBacklogTask({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        taskId: "t-u",
        taskStatus: "CANCELED",
      });

      expect(result).toEqual(taskPayload);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should throw immediately on ConflictException", async () => {
      const err = new Error("conflict");
      err.name = "ConflictException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        updateBacklogTask({
          ...baseInput,
          agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
          taskId: "t-u",
          taskStatus: "CANCELED",
        }),
      ).rejects.toThrow("conflict");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  // ─── listExecutions ──────────────────────────────────────────────────────────

  describe("listExecutions", () => {
    it("should return executions array and nextToken", async () => {
      const executions = [{ executionId: "e-1", agentType: "investigation" }];
      mockSend.mockResolvedValueOnce({ executions, nextToken: "page2" });

      const result = await listExecutions({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        taskId: "t-list",
      });

      expect(result).toEqual({ executions, nextToken: "page2" });
    });

    it("should default executions to empty array when response field is undefined", async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await listExecutions({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        taskId: "t-list",
      });

      expect(result).toEqual({ executions: [], nextToken: undefined });
    });

    it("should retry on ThrottlingException", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const executions = [{ executionId: "e-2" }];

      mockSend.mockRejectedValueOnce(throttleErr).mockResolvedValueOnce({ executions });

      const result = await listExecutions({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        taskId: "t-list",
      });

      expect(result.executions).toEqual(executions);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // ─── listJournalRecords ──────────────────────────────────────────────────────

  describe("listJournalRecords", () => {
    it("should return records array and nextToken", async () => {
      const records = [{ recordId: "r-1", recordType: "investigation_summary_md", content: "# Findings" }];
      mockSend.mockResolvedValueOnce({ records, nextToken: null });

      const result = await listJournalRecords({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        executionId: "e-1",
        recordType: "investigation_summary_md",
      });

      expect(result).toEqual({ records, nextToken: null });
    });

    it("should emit log with executionId field", async () => {
      mockSend.mockResolvedValueOnce({ records: [] });

      await listJournalRecords({
        ...baseInput,
        agentSpaceId: "s1",
        executionId: "exec-abc",
      });

      const logEntry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logEntry.executionId).toBe("exec-abc");
      expect(logEntry.agentSpaceId).toBe("s1");
    });

    it("should default records to empty array when response field is undefined", async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await listJournalRecords({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        executionId: "e-1",
      });

      expect(result).toEqual({ records: [], nextToken: undefined });
    });

    it("should pass recordType filter to the command", async () => {
      mockSend.mockResolvedValueOnce({ records: [] });

      await listJournalRecords({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        executionId: "e-1",
        recordType: "mitigation_summary_md",
        limit: 10,
      });

      const { ListJournalRecordsCommand } = require("@aws-sdk/client-devops-agent");
      const commandInput = ListJournalRecordsCommand.mock.calls[0][0];
      expect(commandInput.recordType).toBe("mitigation_summary_md");
      expect(commandInput.limit).toBe(10);
      expect(commandInput).not.toHaveProperty("correlationId");
    });

    it("should retry on ThrottlingException", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const records = [{ recordId: "r-2" }];

      mockSend.mockRejectedValueOnce(throttleErr).mockResolvedValueOnce({ records });

      const result = await listJournalRecords({
        ...baseInput,
        agentSpaceId: "arn:aws:aidevops:us-east-1:123456789012:agentspace/s1",
        executionId: "e-1",
      });

      expect(result.records).toEqual(records);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // ─── createAsset ─────────────────────────────────────────────────────────────

  describe("createAsset", () => {
    it("should return the created asset and strip non-command fields", async () => {
      mockSend.mockResolvedValueOnce({ asset: { assetId: "asset-1", version: 1 } });

      const result = await createAsset({
        ...baseInput,
        agentSpaceId: "s1",
        assetType: "attachment",
        content: { file: { path: "a.txt", body: { text: "hi" } } },
      });

      expect(result).toEqual({ assetId: "asset-1", version: 1 });
      const { CreateAssetCommand } = require("@aws-sdk/client-devops-agent");
      const commandInput = CreateAssetCommand.mock.calls[0][0];
      expect(commandInput).not.toHaveProperty("correlationId");
      expect(commandInput).not.toHaveProperty("requesterCognitoSub");
    });
  });

  // ─── deleteAsset ─────────────────────────────────────────────────────────────

  describe("deleteAsset", () => {
    it("should send a DeleteAsset command with agentSpaceId and assetId", async () => {
      mockSend.mockResolvedValueOnce({});

      await deleteAsset({ ...baseInput, agentSpaceId: "s1", assetId: "asset-1" });

      const { DeleteAssetCommand } = require("@aws-sdk/client-devops-agent");
      const commandInput = DeleteAssetCommand.mock.calls[0][0];
      expect(commandInput).toEqual({ agentSpaceId: "s1", assetId: "asset-1" });
      expect(commandInput).not.toHaveProperty("correlationId");
    });

    it("should retry on ThrottlingException", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      mockSend.mockRejectedValueOnce(throttleErr).mockResolvedValueOnce({});

      await deleteAsset({ ...baseInput, agentSpaceId: "s1", assetId: "asset-1" });

      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getAgentSpace ───────────────────────────────────────────────────────────

  describe("getAgentSpace", () => {
    it("should return agent space metadata on success", async () => {
      const agentSpacePayload = {
        agentSpaceId: "my-space",
        agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space",
        status: "ACTIVE",
      };
      mockSend.mockResolvedValueOnce(agentSpacePayload);

      const result = await getAgentSpace({
        ...baseInput,
        agentSpaceId: "my-space",
      });

      expect(result).toEqual(agentSpacePayload);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should NOT pass correlationId or requesterCognitoSub to the SDK command", async () => {
      mockSend.mockResolvedValueOnce({ agentSpaceId: "s1" });

      await getAgentSpace({
        ...baseInput,
        agentSpaceId: "s1",
      });

      const { GetAgentSpaceCommand } = require("@aws-sdk/client-devops-agent");
      const commandInput = GetAgentSpaceCommand.mock.calls[0][0];
      expect(commandInput).not.toHaveProperty("correlationId");
      expect(commandInput).not.toHaveProperty("requesterCognitoSub");
      expect(commandInput).toHaveProperty("agentSpaceId", "s1");
    });

    it("should retry on ThrottlingException", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      mockSend.mockRejectedValueOnce(throttleErr).mockResolvedValueOnce({ agentSpaceId: "s1" });

      const result = await getAgentSpace({
        ...baseInput,
        agentSpaceId: "s1",
      });

      expect(result.agentSpaceId).toBe("s1");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should throw immediately on ResourceNotFoundException", async () => {
      const err = new Error("agent space not found");
      err.name = "ResourceNotFoundException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        getAgentSpace({
          ...baseInput,
          agentSpaceId: "nonexistent",
        }),
      ).rejects.toThrow("agent space not found");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should emit structured log with agentSpaceId", async () => {
      mockSend.mockResolvedValueOnce({ agentSpaceId: "s1" });

      await getAgentSpace({
        ...baseInput,
        agentSpaceId: "s1",
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logEntry = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logEntry.action).toBe("aidevops.GetAgentSpace");
      expect(logEntry.agentSpaceId).toBe("s1");
      expect(logEntry.outcome).toBe("success");
    });

    it("should use cross-region client when region is specified", async () => {
      mockSend.mockResolvedValueOnce({ agentSpaceId: "s1" });
      const { DevOpsAgentClient } = require("@aws-sdk/client-devops-agent");
      const callCountBefore = DevOpsAgentClient.mock.calls.length;

      await getAgentSpace({
        ...baseInput,
        agentSpaceId: "s1",
        region: "eu-central-1",
      });

      // Should create a new regional client for eu-central-1
      expect(DevOpsAgentClient.mock.calls.length).toBe(callCountBefore + 1);
    });
  });

  // ─── Cross-region client caching ────────────────────────────────────────────

  describe("cross-region client", () => {
    it("should use the default client when region matches AWS_REGION", async () => {
      const { DevOpsAgentClient } = require("@aws-sdk/client-devops-agent");
      const callCountBefore = DevOpsAgentClient.mock.calls.length;
      mockSend.mockResolvedValueOnce({ task: { taskId: "t1" } });

      await getBacklogTask({
        ...baseInput,
        agentSpaceId: "s1",
        taskId: "t1",
        region: "us-east-1",
      });

      // Should NOT create a new regional client
      expect(DevOpsAgentClient.mock.calls.length).toBe(callCountBefore);
    });

    it("should create a regional client for a different region", async () => {
      const { DevOpsAgentClient } = require("@aws-sdk/client-devops-agent");
      const callCountBefore = DevOpsAgentClient.mock.calls.length;
      mockSend.mockResolvedValueOnce({ task: { taskId: "t1" } });

      await getBacklogTask({ ...baseInput, agentSpaceId: "s1", taskId: "t1", region: "us-west-2" });

      // Should create exactly one new regional client
      expect(DevOpsAgentClient.mock.calls.length).toBe(callCountBefore + 1);
    });

    it("should reuse cached regional client for repeated calls to same region", async () => {
      const { DevOpsAgentClient } = require("@aws-sdk/client-devops-agent");
      mockSend.mockResolvedValue({ task: { taskId: "t1" } });

      // First call to a fresh region creates a client
      const callCountBefore = DevOpsAgentClient.mock.calls.length;
      await getBacklogTask({ ...baseInput, agentSpaceId: "s1", taskId: "t1", region: "ap-northeast-1" });
      const callCountAfterFirst = DevOpsAgentClient.mock.calls.length;
      expect(callCountAfterFirst).toBe(callCountBefore + 1);

      // Second call to same region reuses the cached client
      await getBacklogTask({ ...baseInput, agentSpaceId: "s1", taskId: "t2", region: "ap-northeast-1" });
      expect(DevOpsAgentClient.mock.calls.length).toBe(callCountAfterFirst);
    });

    it("should use default client when region is not provided", async () => {
      const { DevOpsAgentClient } = require("@aws-sdk/client-devops-agent");
      const callCountBefore = DevOpsAgentClient.mock.calls.length;
      mockSend.mockResolvedValueOnce({ task: { taskId: "t1" } });

      await getBacklogTask({
        ...baseInput,
        agentSpaceId: "s1",
        taskId: "t1",
      });

      // Should NOT create a new client
      expect(DevOpsAgentClient.mock.calls.length).toBe(callCountBefore);
    });
  });
});
