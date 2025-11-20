// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to set env vars before any module loading
vi.hoisted(() => {
  process.env.API_GATEWAY_ENDPOINT = "https://api.example.com";
  process.env.AWS_REGION = "us-east-1";
  process.env.SCENARIOS_BUCKET_NAME = "test-bucket";
  process.env.SOLUTION_ID = "test-solution";
  process.env.UUID = "test-uuid";
  process.env.VERSION = "1.0.0";
  process.env.METRIC_URL = "https://metrics.example.com";
});

import type { AgentCoreContext, AgentCoreEvent } from "../src/lib/common.js";
import { AppError } from "../src/lib/errors.js";

// Mock only the tool handlers - they're already tested individually
vi.mock("../src/tools/index.js", () => ({
  handleListScenarios: vi.fn(),
  handleGetScenarioDetails: vi.fn(),
  handleListTestRuns: vi.fn(),
  handleGetTestRun: vi.fn(),
  handleGetLatestTestRun: vi.fn(),
  handleGetBaselineTestRun: vi.fn(),
  handleGetTestRunArtifacts: vi.fn(),
}));

// Mock logger to avoid console output
vi.mock("../src/lib/logger.js", () => ({
  startRequest: vi.fn(),
  logRequestComplete: vi.fn(),
  logRequestError: vi.fn(),
}));

// Mock metrics to avoid external calls
vi.mock("../src/lib/metrics.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/metrics.js")>(
    "../src/lib/metrics.js"
  );
  return {
    ...actual,
    sendToolUsageMetric: vi.fn().mockResolvedValue(undefined),
  };
});

// Import after mocks
import { handler } from "../src/index.js";
import * as logger from "../src/lib/logger.js";
import * as metrics from "../src/lib/metrics.js";
import * as tools from "../src/tools/index.js";

describe("Lambda Handler", () => {
  let mockContext: AgentCoreContext;
  let mockEvent: AgentCoreEvent;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      callbackWaitsForEmptyEventLoop: false,
      functionVersion: "1",
      functionName: "test-function",
      memoryLimitInMB: "128",
      logGroupName: "/aws/lambda/test",
      logStreamName: "test-stream",
      clientContext: {
        custom: {
          bedrockAgentCoreTargetId: "target-123",
          bedrockAgentCoreGatewayId: "gateway-123",
          bedrockAgentCoreMessageVersion: "1.0",
          bedrockAgentCoreMcpMessageId: "msg-123",
          bedrockAgentCoreAwsRequestId: "req-123",
          bedrockAgentCoreToolName: "gateway-target___list_scenarios",
        },
      },
      invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789:function:test",
      awsRequestId: "test-request-id",
    };

    mockEvent = {};
  });

  describe("Tool routing", () => {
    it("should route list_scenarios correctly", async () => {
      const mockResult = { scenarios: [] };
      vi.mocked(tools.handleListScenarios).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockResult);
      expect(tools.handleListScenarios).toHaveBeenCalled();
    });

    it("should route get_scenario_details correctly", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName =
        "gateway-target___get_scenario_details";
      const mockResult = { id: "test-123" };
      vi.mocked(tools.handleGetScenarioDetails).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockResult);
      expect(tools.handleGetScenarioDetails).toHaveBeenCalled();
    });

    it("should route list_test_runs correctly", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName = "gateway-target___list_test_runs";
      const mockResult = { testRuns: [] };
      vi.mocked(tools.handleListTestRuns).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockResult);
      expect(tools.handleListTestRuns).toHaveBeenCalled();
    });

    it("should route get_test_run correctly", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName = "gateway-target___get_test_run";
      const mockResult = { id: "run-123" };
      vi.mocked(tools.handleGetTestRun).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockResult);
      expect(tools.handleGetTestRun).toHaveBeenCalled();
    });

    it("should route get_latest_test_run correctly", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName =
        "gateway-target___get_latest_test_run";
      const mockResult = { id: "run-456" };
      vi.mocked(tools.handleGetLatestTestRun).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockResult);
      expect(tools.handleGetLatestTestRun).toHaveBeenCalled();
    });

    it("should route get_baseline_test_run correctly", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName =
        "gateway-target___get_baseline_test_run";
      const mockResult = { id: "run-789" };
      vi.mocked(tools.handleGetBaselineTestRun).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockResult);
      expect(tools.handleGetBaselineTestRun).toHaveBeenCalled();
    });

    it("should route get_test_run_artifacts correctly", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName =
        "gateway-target___get_test_run_artifacts";
      const mockResult = { artifacts: [] };
      vi.mocked(tools.handleGetTestRunArtifacts).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(mockResult);
      expect(tools.handleGetTestRunArtifacts).toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should handle unknown tool name with 400 error", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName = "gateway-target___unknown_tool";

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("Unknown tool");
    });

    it("should handle AppError and preserve status code", async () => {
      vi.mocked(tools.handleListScenarios).mockRejectedValue(new AppError("Not found", 404));

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Not found");
    });

    it("should handle generic Error with 500 status code", async () => {
      vi.mocked(tools.handleListScenarios).mockRejectedValue(new Error("Unexpected error"));

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Internal server error");
    });
  });

  describe("Response format", () => {
    it("should return proper success response structure", async () => {
      const mockResult = { data: "test" };
      vi.mocked(tools.handleListScenarios).mockResolvedValue(mockResult);

      const response = await handler(mockEvent, mockContext);

      expect(response).toHaveProperty("statusCode", 200);
      expect(response).toHaveProperty("headers");
      expect(response.headers).toEqual({ "Content-Type": "application/json" });
      expect(response).toHaveProperty("body");
      expect(() => JSON.parse(response.body)).not.toThrow();
    });

    it("should return proper error response structure", async () => {
      vi.mocked(tools.handleListScenarios).mockRejectedValue(new AppError("Test error", 400));

      const response = await handler(mockEvent, mockContext);

      expect(response).toHaveProperty("statusCode", 400);
      expect(response).toHaveProperty("headers");
      expect(response.headers).toEqual({ "Content-Type": "application/json" });
      expect(response).toHaveProperty("body");
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("error");
    });
  });

  describe("Tool name parsing", () => {
    it("should extract tool name after delimiter", async () => {
      mockContext.clientContext.custom.bedrockAgentCoreToolName =
        "my-gateway-my-target___get_test_run";
      vi.mocked(tools.handleGetTestRun).mockResolvedValue({ id: "test" });

      await handler(mockEvent, mockContext);

      expect(tools.handleGetTestRun).toHaveBeenCalled();
      expect(logger.startRequest).toHaveBeenCalledWith(mockContext, "get_test_run", mockEvent);
    });
  });

  describe("Logging integration", () => {
    it("should call startRequest at beginning", async () => {
      vi.mocked(tools.handleListScenarios).mockResolvedValue({ data: "test" });

      await handler(mockEvent, mockContext);

      expect(logger.startRequest).toHaveBeenCalledWith(mockContext, "list_scenarios", mockEvent);
    });

    it("should call logRequestComplete on success", async () => {
      vi.mocked(tools.handleListScenarios).mockResolvedValue({ data: "test" });

      await handler(mockEvent, mockContext);

      expect(logger.logRequestComplete).toHaveBeenCalledWith(
        "list_scenarios",
        expect.any(Number),
        200,
        expect.any(Number)
      );
    });

    it("should call logRequestError on failure", async () => {
      vi.mocked(tools.handleListScenarios).mockRejectedValue(new Error("Test error"));

      await handler(mockEvent, mockContext);

      expect(logger.logRequestError).toHaveBeenCalledWith(
        "list_scenarios",
        expect.any(Error),
        expect.any(Number),
        500,
        expect.any(Number)
      );
    });
  });

  describe("Metrics integration", () => {
    it("should send success metrics", async () => {
      vi.mocked(tools.handleListScenarios).mockResolvedValue({ data: "test" });

      await handler(mockEvent, mockContext);

      expect(metrics.sendToolUsageMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          ToolName: "list_scenarios",
          Status: "success",
          StatusCode: 200,
          TokenCount: expect.any(Number),
          DurationMs: expect.any(Number),
        })
      );
    });

    it("should send failure metrics", async () => {
      vi.mocked(tools.handleListScenarios).mockRejectedValue(new AppError("Test error", 404));

      await handler(mockEvent, mockContext);

      expect(metrics.sendToolUsageMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          ToolName: "list_scenarios",
          Status: "failure",
          StatusCode: 404,
        })
      );
    });
  });
});
