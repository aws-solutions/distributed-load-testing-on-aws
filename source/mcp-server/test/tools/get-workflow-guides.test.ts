// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import { handleGetWorkflowGuides } from "../../src/tools/get-workflow-guides.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

describe("handleGetWorkflowGuides", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // Returns the guide object for each valid workflow name from guides.json
    it("should return guide for 'run_and_monitor' workflow", async () => {
      const event: AgentCoreEvent = { workflow: "run_and_monitor" };
      const result = await handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event);
      expect(result).toBeDefined();
    });

    it("should return guide for 'baseline_comparison' workflow", async () => {
      const event: AgentCoreEvent = { workflow: "baseline_comparison" };
      const result = await handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event);
      expect(result).toBeDefined();
    });

    it("should return guide for 'schedule_test' workflow", async () => {
      const event: AgentCoreEvent = { workflow: "schedule_test" };
      const result = await handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event);
      expect(result).toBeDefined();
    });

    it("should return guide for 'create_and_run' workflow", async () => {
      const event: AgentCoreEvent = { workflow: "create_and_run" };
      const result = await handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event);
      expect(result).toBeDefined();
    });

    it("should return guide for 'update_and_run' workflow", async () => {
      const event: AgentCoreEvent = { workflow: "update_and_run" };
      const result = await handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event);
      expect(result).toBeDefined();
    });
  });

  describe("Parameter validation", () => {
    // GetWorkflowGuidesSchema requires workflow field
    it("should throw AppError for missing workflow", async () => {
      const event: AgentCoreEvent = {};

      await expect(handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("Validation failed");
      }
    });

    // workflow must be one of the VALID_WORKFLOWS enum values
    it("should throw AppError for invalid workflow name", async () => {
      const event: AgentCoreEvent = { workflow: "nonexistent_workflow" };

      await expect(handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleGetWorkflowGuides(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });
  });
});
