// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  validateTestId,
  validateTestRunId,
  validatePathParameters,
  validateScenariosQuery,
  validateScenarioQuery,
  validateTestRunsQuery,
  validateBaselineQuery,
  validateCreateTestBody,
  validateSetBaselineBody,
  validateDeleteTestRunsBody,
  validateQueryForResource,
  validateBodyForResource,
} from "./validators";

describe("Validation Functions", () => {
  describe("validateTestId", () => {
    it("should validate correct testId", () => {
      const validTestIds = [
        "test-123",
        "my-test",
        "TEST123",
        "test-with-many-hyphens",
        "a",
        "a".repeat(128), // max length
      ];

      validTestIds.forEach((testId) => {
        expect(() => validateTestId(testId)).not.toThrow();
        expect(validateTestId(testId)).toBe(testId);
      });
    });

    it("should throw error for invalid testId", () => {
      const invalidTestIds = [
        undefined,
        "",
        "test_with_underscore",
        "test with spaces",
        "test@special",
        "test.dot",
        "a".repeat(129), // exceeds max length
        "123-test-!", // special character
      ];

      invalidTestIds.forEach((testId) => {
        expect(() => validateTestId(testId)).toThrow();
      });
    });

    it("should provide descriptive error messages", () => {
      expect(() => validateTestId(undefined)).toThrow("Required");
      expect(() => validateTestId("")).toThrow("testId is required");
      expect(() => validateTestId("a".repeat(129))).toThrow("testId must not exceed 128 characters");
      expect(() => validateTestId("test_invalid")).toThrow(
        "testId must contain only alphanumeric characters and hyphens"
      );
    });
  });

  describe("validateTestRunId", () => {
    it("should validate correct testRunId", () => {
      const validTestRunIds = [
        "run-123",
        "my-run",
        "RUN123",
        "run-with-many-hyphens",
        "r",
        "r".repeat(128), // max length
      ];

      validTestRunIds.forEach((testRunId) => {
        expect(() => validateTestRunId(testRunId)).not.toThrow();
        expect(validateTestRunId(testRunId)).toBe(testRunId);
      });
    });

    it("should throw error for invalid testRunId", () => {
      const invalidTestRunIds = [
        undefined,
        "",
        "run_with_underscore",
        "run with spaces",
        "run@special",
        "run.dot",
        "r".repeat(129), // exceeds max length
        "123-run-!", // special character
      ];

      invalidTestRunIds.forEach((testRunId) => {
        expect(() => validateTestRunId(testRunId)).toThrow();
      });
    });

    it("should provide descriptive error messages", () => {
      expect(() => validateTestRunId(undefined)).toThrow("Required");
      expect(() => validateTestRunId("")).toThrow("testRunId is required");
      expect(() => validateTestRunId("r".repeat(129))).toThrow("testRunId must not exceed 128 characters");
      expect(() => validateTestRunId("run_invalid")).toThrow(
        "testRunId must contain only alphanumeric characters and hyphens"
      );
    });
  });

  describe("validatePathParameters", () => {
    it("should validate correct path parameters", () => {
      const validParams: Array<Record<string, string> | undefined> = [
        {},
        { testId: "test-123" },
        { testRunId: "run-123" },
        { testId: "test-123", testRunId: "run-123" },
      ];

      validParams.forEach((params) => {
        expect(() => validatePathParameters(params)).not.toThrow();
      });
    });

    it("should handle undefined input", () => {
      expect(() => validatePathParameters(undefined)).not.toThrow();
    });

    it("should throw error for invalid path parameters", () => {
      const invalidParams: Array<Record<string, string>> = [
        { testId: "" },
        { testRunId: "" },
        { testId: "invalid_id" },
        { testRunId: "invalid_run" },
      ];

      invalidParams.forEach((params) => {
        expect(() => validatePathParameters(params)).toThrow();
      });
    });
  });

  describe("validateScenariosQuery", () => {
    it("should validate correct scenarios query parameters", () => {
      const validQueries: Array<Record<string, string> | undefined> = [
        {},
        { op: "listRegions" },
        { tags: "tag1,tag2" },
        { op: "listRegions", tags: "tag1" },
      ];

      validQueries.forEach((query) => {
        expect(() => validateScenariosQuery(query)).not.toThrow();
      });
    });

    it("should handle undefined input", () => {
      expect(() => validateScenariosQuery(undefined)).not.toThrow();
    });

    it("should throw error for invalid scenarios query", () => {
      const invalidQueries: Array<Record<string, string>> = [
        { op: "invalidOperation" },
        { tags: "a".repeat(501) }, // exceeds max length
        { invalidParam: "value" }, // strict mode - unknown properties not allowed
      ];

      invalidQueries.forEach((query) => {
        expect(() => validateScenariosQuery(query)).toThrow();
      });
    });
  });

  describe("validateScenarioQuery", () => {
    it("should validate correct scenario query parameters", () => {
      const validQueries: Array<Record<string, string> | undefined> = [
        {},
        { history: "true" },
        { history: "false" },
        { latest: "true" },
        { latest: "false" },
        { history: "true", latest: "false" },
      ];

      validQueries.forEach((query) => {
        expect(() => validateScenarioQuery(query)).not.toThrow();
      });
    });

    it("should throw error for invalid scenario query", () => {
      const invalidQueries: Array<Record<string, string>> = [
        { history: "yes" }, // must be "true" or "false"
        { latest: "no" }, // must be "true" or "false"
        { invalidParam: "value" }, // strict mode
      ];

      invalidQueries.forEach((query) => {
        expect(() => validateScenarioQuery(query)).toThrow();
      });
    });
  });

  describe("validateTestRunsQuery", () => {
    it("should validate correct test runs query parameters", () => {
      const validQueries: Array<Record<string, string> | undefined> = [
        {},
        { limit: "10" },
        { limit: "100" },
        { start_timestamp: "2024-01-01T00:00:00Z" },
        { end_timestamp: "2024-12-31T23:59:59Z" },
        { latest: "true" },
        { next_token: "abc123" },
        {
          limit: "50",
          start_timestamp: "2024-01-01T00:00:00Z",
          end_timestamp: "2024-12-31T23:59:59Z",
          latest: "false",
          next_token: "token123",
        },
      ];

      validQueries.forEach((query) => {
        expect(() => validateTestRunsQuery(query)).not.toThrow();
      });
    });

    it("should transform string limit to number", () => {
      const result = validateTestRunsQuery({ limit: "25" });
      expect(result.limit).toBe(25);
      expect(typeof result.limit).toBe("number");
    });

    it("should throw error for invalid test runs query", () => {
      const invalidQueries: Array<Record<string, string>> = [
        { limit: "0" }, // must be >= 1
        { limit: "101" }, // must be <= 100
        { limit: "abc" }, // must be numeric
        { start_timestamp: "invalid-date" },
        { end_timestamp: "2024-13-01" }, // invalid month
        { latest: "yes" }, // must be "true" or "false"
        { invalidParam: "value" }, // strict mode
      ];

      invalidQueries.forEach((query) => {
        expect(() => validateTestRunsQuery(query)).toThrow();
      });
    });
  });

  describe("validateBaselineQuery", () => {
    it("should validate correct baseline query parameters", () => {
      const validQueries: Array<Record<string, string> | undefined> = [{}, { data: "true" }, { data: "false" }];

      validQueries.forEach((query) => {
        expect(() => validateBaselineQuery(query)).not.toThrow();
      });
    });

    it("should throw error for invalid baseline query", () => {
      const invalidQueries: Array<Record<string, string>> = [
        { data: "yes" }, // must be "true" or "false"
        { invalidParam: "value" }, // strict mode
      ];

      invalidQueries.forEach((query) => {
        expect(() => validateBaselineQuery(query)).toThrow();
      });
    });
  });

  describe("validateCreateTestBody", () => {
    const validTestBody = {
      testName: "Valid Test Name",
      testDescription: "Valid test description",
      testType: "simple" as const,
      testTaskConfigs: [
        {
          region: "us-east-1",
          taskCount: 1,
          concurrency: 1,
        },
      ],
      testScenario: {
        execution: [
          {
            "hold-for": "1m",
            "ramp-up": "30s",
          },
        ],
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
        "us-east-1": {
          dltAvailableTasks: 10,
        },
      },
    };

    it("should validate correct test creation body", () => {
      expect(() => validateCreateTestBody(validTestBody)).not.toThrow();
    });

    it("should validate with optional fields", () => {
      const bodyWithOptionals = {
        ...validTestBody,
        testId: "custom-test-id",
        fileType: "script" as const,
        showLive: true,
        tags: ["tag1", "tag2"],
        scheduleStep: "create" as const,
        scheduleDate: "2024-12-31",
        scheduleTime: "23:59",
      };

      expect(() => validateCreateTestBody(bodyWithOptionals)).not.toThrow();
    });

    it("should throw error for missing required fields", () => {
      const requiredFields = ["testName", "testDescription", "testTaskConfigs", "testScenario", "regionalTaskDetails"];

      requiredFields.forEach((field) => {
        const invalidBody = { ...validTestBody };
        delete invalidBody[field as keyof typeof invalidBody];
        expect(() => validateCreateTestBody(invalidBody)).toThrow();
      });
    });

    it("should throw error for invalid field types", () => {
      const invalidBodies = [
        { ...validTestBody, testName: "" }, // too short
        { ...validTestBody, testName: "a".repeat(256) }, // too long
        { ...validTestBody, testType: "invalid" }, // invalid enum
        { ...validTestBody, testTaskConfigs: [] }, // empty array
        { ...validTestBody, tags: new Array(6).fill("tag") }, // too many tags
        {
          ...validTestBody,
          testTaskConfigs: [
            {
              region: "invalid-region", // invalid region format
              taskCount: 1,
              concurrency: 1,
            },
          ],
        },
      ];

      invalidBodies.forEach((body) => {
        expect(() => validateCreateTestBody(body)).toThrow();
      });
    });
  });

  describe("validateSetBaselineBody", () => {
    it("should validate correct set baseline body", () => {
      const validBody = { testRunId: "run-123" };
      expect(() => validateSetBaselineBody(validBody)).not.toThrow();
    });

    it("should throw error for invalid set baseline body", () => {
      const invalidBodies = [
        {}, // missing testRunId
        { testRunId: "" }, // empty testRunId
        { testRunId: "invalid_run" }, // invalid format
        { testRunId: "run-123", extraField: "not allowed" }, // strict mode
      ];

      invalidBodies.forEach((body) => {
        expect(() => validateSetBaselineBody(body)).toThrow();
      });
    });
  });

  describe("validateDeleteTestRunsBody", () => {
    it("should validate correct delete test runs body", () => {
      const validBodies = [["run-123"], ["run-123", "run-456"], ["run-123", "run-456", "run-789"]];

      validBodies.forEach((body) => {
        expect(() => validateDeleteTestRunsBody(body)).not.toThrow();
      });
    });

    it("should throw error for invalid delete test runs body", () => {
      const invalidBodies = [
        [], // empty array
        [""], // empty string in array
        ["invalid_run"], // invalid format
        "not-an-array", // not an array
      ];

      invalidBodies.forEach((body) => {
        expect(() => validateDeleteTestRunsBody(body)).toThrow();
      });
    });
  });

  describe("validateQueryForResource", () => {
    it("should route to correct query validator based on resource", () => {
      // Test each resource routing
      expect(() => validateQueryForResource("/scenarios", { op: "listRegions" })).not.toThrow();
      expect(() => validateQueryForResource("/scenarios/{testId}", { history: "true" })).not.toThrow();
      expect(() => validateQueryForResource("/scenarios/{testId}/testruns", { limit: "10" })).not.toThrow();
      expect(() => validateQueryForResource("/scenarios/{testId}/baseline", { data: "true" })).not.toThrow();
    });

    it("should return query params unchanged for unknown resources", () => {
      const unknownQuery = { customParam: "value" };
      const result = validateQueryForResource("/unknown", unknownQuery);
      expect(result).toEqual(unknownQuery);
    });

    it("should handle undefined query params", () => {
      const result = validateQueryForResource("/scenarios", undefined);
      expect(result).toEqual({});
    });

    it("should throw validation errors for invalid query params", () => {
      expect(() => validateQueryForResource("/scenarios", { op: "invalid" })).toThrow();
      expect(() => validateQueryForResource("/scenarios/{testId}", { history: "invalid" })).toThrow();
    });
  });

  describe("validateBodyForResource", () => {
    const validCreateTestBody = {
      testName: "Test Name",
      testDescription: "Test Description",
      testType: "simple" as const,
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
        "us-east-1": { dltAvailableTasks: 10 },
      },
    };

    it("should route to correct body validator based on resource and method", () => {
      expect(() => validateBodyForResource("/scenarios", "POST", validCreateTestBody)).not.toThrow();
      expect(() =>
        validateBodyForResource("/scenarios/{testId}/baseline", "PUT", { testRunId: "run-123" })
      ).not.toThrow();
      expect(() => validateBodyForResource("/scenarios/{testId}/testruns", "DELETE", ["run-123"])).not.toThrow();
    });

    it("should return body unchanged for unknown resource/method combinations", () => {
      const unknownBody = { customField: "value" };
      const result = validateBodyForResource("/unknown", "POST", unknownBody);
      expect(result).toBe(unknownBody);
    });

    it("should return body unchanged for GET requests", () => {
      const body = { someField: "value" };
      const result = validateBodyForResource("/scenarios", "GET", body);
      expect(result).toBe(body);
    });

    it("should throw validation errors for invalid body data", () => {
      expect(() => validateBodyForResource("/scenarios", "POST", { invalidField: "value" })).toThrow();
      expect(() => validateBodyForResource("/scenarios/{testId}/baseline", "PUT", { invalidField: "value" })).toThrow();
      expect(() => validateBodyForResource("/scenarios/{testId}/testruns", "DELETE", [])).toThrow();
    });
  });
});
