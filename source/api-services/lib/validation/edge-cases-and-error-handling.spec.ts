// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Edge cases and error handling tests for the validation module
// This file tests boundary conditions, validation edge cases, and error scenarios
// that are not covered by the main validation test suites

import {
  validateCreateTestBody,
  validateTestId,
  validateTestRunId,
  validatePathParameters,
  validateScenariosQuery,
  validateTestRunsQuery,
  validateBaselineQuery,
  validateSetBaselineBody,
  validateDeleteTestRunsBody,
  validateQueryForResource,
  validateBodyForResource,
} from "./validators";

describe("Validation Module - Edge Cases and Error Handling", () => {
  // Test boundary conditions and error cases for testId validation
  describe("validateTestId edge cases and boundary conditions", () => {
    it("should throw error for undefined testId", () => {
      expect(() => validateTestId(undefined)).toThrow();
    });

    it("should throw error for empty testId", () => {
      expect(() => validateTestId("")).toThrow();
    });

    it("should throw error for testId with invalid characters", () => {
      expect(() => validateTestId("test@id")).toThrow();
    });

    it("should throw error for testId exceeding length limit", () => {
      const longTestId = "a".repeat(129);
      expect(() => validateTestId(longTestId)).toThrow();
    });

    it("should validate correct testId", () => {
      const result = validateTestId("valid-test-id-123");
      expect(result).toBe("valid-test-id-123");
    });
  });

  // Test validateTestRunId with edge cases
  describe("validateTestRunId function", () => {
    it("should throw error for undefined testRunId", () => {
      expect(() => validateTestRunId(undefined)).toThrow();
    });

    it("should throw error for empty testRunId", () => {
      expect(() => validateTestRunId("")).toThrow();
    });

    it("should throw error for testRunId with invalid characters", () => {
      expect(() => validateTestRunId("run@id")).toThrow();
    });

    it("should validate correct testRunId", () => {
      const result = validateTestRunId("valid-run-id-456");
      expect(result).toBe("valid-run-id-456");
    });
  });

  // Test validatePathParameters edge cases
  describe("validatePathParameters function", () => {
    it("should handle undefined pathParams", () => {
      const result = validatePathParameters(undefined);
      expect(result).toBeDefined();
    });

    it("should handle empty pathParams object", () => {
      const result = validatePathParameters({});
      expect(result).toBeDefined();
    });

    it("should validate pathParams with testId", () => {
      const result = validatePathParameters({ testId: "test-123" });
      expect(result.testId).toBe("test-123");
    });
  });

  // Test query validation functions
  describe("Query validation functions", () => {
    it("should validate scenarios query with tags", () => {
      const result = validateScenariosQuery({ tags: "web,api,performance" });
      expect(result.tags).toBe("web,api,performance");
    });

    it("should validate scenarios query with listRegions op", () => {
      const result = validateScenariosQuery({ op: "listRegions" });
      expect(result.op).toBe("listRegions");
    });

    it("should throw error for invalid scenarios query op", () => {
      expect(() => validateScenariosQuery({ op: "invalid" })).toThrow();
    });

    it("should validate testRuns query with limit", () => {
      const result = validateTestRunsQuery({ limit: "10" });
      expect(result.limit).toBe(10);
    });

    it("should throw error for invalid testRuns query limit", () => {
      expect(() => validateTestRunsQuery({ limit: "150" })).toThrow();
    });

    it("should throw error for invalid timestamp format", () => {
      expect(() => validateTestRunsQuery({ start_timestamp: "invalid-date" })).toThrow();
    });

    it("should validate baseline query with data parameter", () => {
      const result = validateBaselineQuery({ data: "true" });
      expect(result.data).toBe("true");
    });
  });

  // Test validateCreateTestBody with various scenarios
  describe("validateCreateTestBody function", () => {
    const validTestBody = {
      testName: "Test",
      testDescription: "Description",
      testType: "simple",
      testTaskConfigs: [
        {
          region: "us-east-1",
          taskCount: 1,
          concurrency: 1,
        },
      ],
      testScenario: {
        execution: [{ "hold-for": "1m" }],
        scenarios: {
          "default-scenario": {
            requests: [
              {
                url: "https://example.com",
                method: "GET",
              },
            ],
          },
        },
      },
      regionalTaskDetails: {
        "us-east-1": { dltAvailableTasks: "100" },
      },
    };

    it("should validate valid test body", () => {
      const result = validateCreateTestBody(validTestBody);
      expect(result.testName).toBe("Test");
      expect(result.testTaskConfigs).toHaveLength(1);
    });

    it("should handle string taskCount and concurrency conversion", () => {
      const testBody = {
        ...validTestBody,
        testTaskConfigs: [
          {
            region: "us-east-1",
            taskCount: "10",
            concurrency: "5",
          },
        ],
      };

      const result = validateCreateTestBody(testBody);
      expect(typeof result.testTaskConfigs[0].taskCount).toBe("number");
      expect(typeof result.testTaskConfigs[0].concurrency).toBe("number");
      expect(result.testTaskConfigs[0].taskCount).toBe(10);
      expect(result.testTaskConfigs[0].concurrency).toBe(5);
    });

    it("should throw error for invalid test type", () => {
      const invalidTestBody = {
        ...validTestBody,
        testType: "invalid-type",
      };

      expect(() => validateCreateTestBody(invalidTestBody)).toThrow();
    });

    it("should throw error for missing required fields", () => {
      expect(() => validateCreateTestBody({})).toThrow();
    });

    it("should throw error for invalid region format", () => {
      const invalidTestBody = {
        ...validTestBody,
        testTaskConfigs: [
          {
            region: "invalid-region",
            taskCount: 1,
            concurrency: 1,
          },
        ],
        regionalTaskDetails: {
          "invalid-region": { dltAvailableTasks: "100" },
        },
      };

      expect(() => validateCreateTestBody(invalidTestBody)).toThrow();
    });

    it("should throw error for too many tags", () => {
      const tooManyTagsBody = {
        ...validTestBody,
        tags: ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"], // Exceeds maximum of 5
      };

      expect(() => validateCreateTestBody(tooManyTagsBody)).toThrow();
    });

    it("should throw error for empty testTaskConfigs array", () => {
      const emptyConfigs = {
        ...validTestBody,
        testTaskConfigs: [], // Empty array
      };

      expect(() => validateCreateTestBody(emptyConfigs)).toThrow();
    });

    it("should throw error for empty execution array", () => {
      const emptyExecution = {
        ...validTestBody,
        testScenario: {
          execution: [], // Empty execution array
        },
      };

      expect(() => validateCreateTestBody(emptyExecution)).toThrow();
    });
  });

  // Test validateSetBaselineBody
  describe("validateSetBaselineBody function", () => {
    it("should validate valid baseline body", () => {
      const baselineBody = { testRunId: "run-123" };
      const result = validateSetBaselineBody(baselineBody);
      expect(result.testRunId).toBe("run-123");
    });

    it("should throw error for missing testRunId", () => {
      expect(() => validateSetBaselineBody({})).toThrow();
    });

    it("should throw error for invalid testRunId", () => {
      expect(() => validateSetBaselineBody({ testRunId: "invalid@run" })).toThrow();
    });
  });

  // Test validateDeleteTestRunsBody
  describe("validateDeleteTestRunsBody function", () => {
    it("should validate array of testRunIds", () => {
      const testRunIds = ["run-1", "run-2", "run-3"];
      const result = validateDeleteTestRunsBody(testRunIds);
      expect(result).toHaveLength(3);
      expect(result).toEqual(testRunIds);
    });

    it("should throw error for empty array", () => {
      expect(() => validateDeleteTestRunsBody([])).toThrow();
    });

    it("should throw error for non-array input", () => {
      expect(() => validateDeleteTestRunsBody("not-array")).toThrow();
    });

    it("should throw error for invalid testRunId in array", () => {
      expect(() => validateDeleteTestRunsBody(["valid-run", "invalid@run"])).toThrow();
    });
  });

  // Test validateQueryForResource function
  describe("validateQueryForResource function", () => {
    it("should return as-is for unknown resource", () => {
      const queryParams = { customParam: "value" };
      const result = validateQueryForResource("/unknown/resource", queryParams);
      expect(result).toEqual(queryParams);
    });

    it("should return empty object for undefined queryParams on unknown resource", () => {
      const result = validateQueryForResource("/unknown/resource", undefined);
      expect(result).toEqual({});
    });
  });

  // Test validateBodyForResource function
  describe("validateBodyForResource function", () => {
    it("should return as-is for unknown resource/method combination", () => {
      const customBody = { customField: "value" };
      const result = validateBodyForResource("/unknown/resource", "GET", customBody);
      expect(result).toEqual(customBody);
    });
  });
});
