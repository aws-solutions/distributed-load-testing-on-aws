// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ZodError, ZodIssue } from "zod";
import { formatZodError, getFirstZodError, groupZodIssuesByPath, zodIssuesToValidationErrors } from "./errors";
import { testIdSchema, createTestSchema } from "./schemas";

describe("Error Handling Functions", () => {
  describe("formatZodError", () => {
    it("should format single validation error", () => {
      try {
        testIdSchema.parse("");
      } catch (error) {
        const formatted = formatZodError(error as ZodError);
        expect(formatted).toContain("testId is required");
      }
    });

    it("should format multiple validation errors", () => {
      try {
        createTestSchema.parse({
          testName: "ab", // too short
          testDescription: "x", // too short
          testType: "invalid", // invalid enum
          testTaskConfigs: [], // empty array
          testScenario: {}, // missing execution
          regionalTaskDetails: {}, // empty object
        });
      } catch (error) {
        const formatted = formatZodError(error as ZodError);
        expect(formatted).toContain("testName must be at least 3 characters");
        expect(formatted).toContain("testDescription must be at least 3 characters");
        expect(formatted).toContain("testType must be one of");
        expect(formatted).toContain("At least one test task configuration is required");
      }
    });

    it("should handle nested object validation errors", () => {
      try {
        createTestSchema.parse({
          testName: "Valid Name",
          testDescription: "Valid description",
          testType: "simple",
          testTaskConfigs: [
            {
              region: "invalid-region",
              taskCount: 0, // invalid
              concurrency: -1, // invalid
            },
          ],
          testScenario: {
            execution: [],
          },
          regionalTaskDetails: {
            "us-east-1": {
              dltAvailableTasks: 10,
            },
          },
        });
      } catch (error) {
        const formatted = formatZodError(error as ZodError);
        expect(formatted).toContain("Invalid region format");
        expect(formatted).toContain("Number must be greater than 0");
        expect(formatted).toContain("Number must be greater than 0");
      }
    });

    it("should handle array index paths correctly", () => {
      try {
        createTestSchema.parse({
          testName: "Valid Name",
          testDescription: "Valid description",
          testType: "simple",
          testTaskConfigs: [
            {
              region: "us-east-1",
              taskCount: 1,
              concurrency: 1,
            },
            {
              region: "invalid-region", // error in second item
              taskCount: 1,
              concurrency: 1,
            },
          ],
          testScenario: {
            execution: [{ "hold-for": "1m" }],
          },
          regionalTaskDetails: {
            "us-east-1": { dltAvailableTasks: 10 },
          },
        });
      } catch (error) {
        const formatted = formatZodError(error as ZodError);
        expect(formatted).toContain("testTaskConfigs[1].region");
        expect(formatted).toContain("Invalid region format");
      }
    });

    it("should handle passthrough mode for unknown fields", () => {
      // createTestSchema uses .passthrough() which allows unknown fields
      const testData = {
        testName: "Valid Name",
        testDescription: "Valid description",
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
            "test-scenario": {
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
        unknownField: "allowed with passthrough", // passthrough allows this
      };

      // Should not throw because createTestSchema uses passthrough
      expect(() => createTestSchema.parse(testData)).not.toThrow();

      // The unknown field should be preserved in the result
      const result = createTestSchema.parse(testData);
      expect(result).toHaveProperty("unknownField");
    });
  });

  describe("getFirstZodError", () => {
    it("should return first error message from ZodError", () => {
      try {
        testIdSchema.parse("");
      } catch (error) {
        const firstError = getFirstZodError(error as ZodError);
        expect(firstError).toBe("testId is required");
      }
    });

    it("should return first error when multiple errors exist", () => {
      try {
        createTestSchema.parse({
          testName: "", // first error
          testDescription: "", // second error
          testType: "invalid",
        });
      } catch (error) {
        const firstError = getFirstZodError(error as ZodError);
        expect(firstError).toBe("testName must be at least 3 characters");
      }
    });

    it("should handle nested object errors", () => {
      try {
        createTestSchema.parse({
          testName: "Valid Name",
          testDescription: "Valid description",
          testType: "simple",
          testTaskConfigs: [
            {
              region: "", // first nested error
              taskCount: 1,
              concurrency: 1,
            },
          ],
          testScenario: {
            execution: [{ "hold-for": "1m" }],
          },
          regionalTaskDetails: {
            "us-east-1": { dltAvailableTasks: 10 },
          },
        });
      } catch (error) {
        const firstError = getFirstZodError(error as ZodError);
        expect(firstError).toContain("Invalid region format");
      }
    });

    it("should handle empty ZodError", () => {
      const mockZodError = new ZodError([]);
      const firstError = getFirstZodError(mockZodError);
      expect(firstError).toBe("Validation failed");
    });
  });

  describe("groupZodIssuesByPath", () => {
    it("should group issues by their path", () => {
      const issues: ZodIssue[] = [
        {
          code: "too_small",
          minimum: 3,
          type: "string",
          inclusive: true,
          exact: false,
          message: "testName must be at least 3 characters",
          path: ["testName"],
        },
        {
          code: "too_small",
          minimum: 3,
          type: "string",
          inclusive: true,
          exact: false,
          message: "testDescription must be at least 3 characters",
          path: ["testDescription"],
        },
        {
          code: "invalid_enum_value",
          options: ["simple", "jmeter", "locust", "k6"],
          message: "testType must be one of: simple, jmeter, locust, k6",
          path: ["testType"],
          received: "invalid",
        },
      ];

      const grouped = groupZodIssuesByPath(issues);

      expect(grouped).toHaveProperty("testName");
      expect(grouped).toHaveProperty("testDescription");
      expect(grouped).toHaveProperty("testType");
      expect(grouped.testName).toHaveLength(1);
      expect(grouped.testDescription).toHaveLength(1);
      expect(grouped.testType).toHaveLength(1);
    });

    it("should handle nested paths", () => {
      const issues: ZodIssue[] = [
        {
          code: "invalid_string",
          validation: "regex",
          message: "Invalid region format",
          path: ["testTaskConfigs", 0, "region"],
        },
        {
          code: "too_small",
          minimum: 1,
          type: "number",
          inclusive: true,
          exact: false,
          message: "taskCount must be a positive integer",
          path: ["testTaskConfigs", 0, "taskCount"],
        },
      ];

      const grouped = groupZodIssuesByPath(issues);

      // Check that the properties actually exist in the grouped object
      const keys = Object.keys(grouped);
      expect(keys).toContain("testTaskConfigs[0].region");
      expect(keys).toContain("testTaskConfigs[0].taskCount");
      expect(grouped["testTaskConfigs[0].region"]).toEqual(["Invalid region format"]);
      expect(grouped["testTaskConfigs[0].taskCount"]).toEqual(["taskCount must be a positive integer"]);
    });

    it("should handle multiple issues for same path", () => {
      const issues: ZodIssue[] = [
        {
          code: "too_small",
          minimum: 3,
          type: "string",
          inclusive: true,
          exact: false,
          message: "testName must be at least 3 characters",
          path: ["testName"],
        },
        {
          code: "too_big",
          maximum: 255,
          type: "string",
          inclusive: true,
          exact: false,
          message: "testName must not exceed 255 characters",
          path: ["testName"],
        },
      ];

      const grouped = groupZodIssuesByPath(issues);

      expect(grouped).toHaveProperty("testName");
      expect(grouped.testName).toHaveLength(2);
    });

    it("should handle empty issues array", () => {
      const grouped = groupZodIssuesByPath([]);
      expect(grouped).toEqual({});
    });
  });

  describe("zodIssuesToValidationErrors", () => {
    it("should convert ZodIssues to validation error objects", () => {
      const issues: ZodIssue[] = [
        {
          code: "too_small",
          minimum: 3,
          type: "string",
          inclusive: true,
          exact: false,
          message: "testName must be at least 3 characters",
          path: ["testName"],
        },
        {
          code: "invalid_enum_value",
          options: ["simple", "jmeter", "locust", "k6"],
          message: "testType must be one of: simple, jmeter, locust, k6",
          path: ["testType"],
          received: "invalid",
        },
      ];

      const validationErrors = zodIssuesToValidationErrors(issues);

      expect(validationErrors).toHaveLength(2);

      expect(validationErrors[0]).toEqual({
        field: "testName",
        message: "testName must be at least 3 characters",
        code: "too_small",
        path: ["testName"],
      });

      expect(validationErrors[1]).toEqual({
        field: "testType",
        message: "testType must be one of: simple, jmeter, locust, k6",
        code: "invalid_enum_value",
        path: ["testType"],
      });
    });

    it("should handle nested paths in field names", () => {
      const issues: ZodIssue[] = [
        {
          code: "invalid_string",
          validation: "regex",
          message: "Invalid region format",
          path: ["testTaskConfigs", 0, "region"],
        },
      ];

      const validationErrors = zodIssuesToValidationErrors(issues);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: "testTaskConfigs[0].region",
        message: "Invalid region format",
        code: "invalid_string",
        path: ["testTaskConfigs", 0, "region"],
      });
    });

    it("should handle empty path as value field", () => {
      const issues: ZodIssue[] = [
        {
          code: "invalid_type",
          expected: "object",
          received: "string",
          message: "Expected object, received string",
          path: [],
        },
      ];

      const validationErrors = zodIssuesToValidationErrors(issues);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]).toEqual({
        field: "value",
        message: "Expected object, received string",
        code: "invalid_type",
        path: [],
      });
    });

    it("should handle empty issues array", () => {
      const validationErrors = zodIssuesToValidationErrors([]);
      expect(validationErrors).toEqual([]);
    });
  });

  describe("Error integration with validation functions", () => {
    it("should provide consistent error format across validation functions", () => {
      // Test that all validation functions use the same error handling
      const invalidInputs = [
        { validator: "testId", input: "" },
        { validator: "testRunId", input: "invalid_format" },
        { validator: "createTestBody", input: { testName: "ab" } },
      ];

      invalidInputs.forEach(({ validator, input }) => {
        try {
          switch (validator) {
            case "testId":
              testIdSchema.parse(input);
              break;
            case "testRunId":
              testIdSchema.parse(input); // reuse testIdSchema for consistency
              break;
            case "createTestBody":
              createTestSchema.parse(input);
              break;
          }
          expect(true).toBe(false); // Expected validation to throw but it didn't
        } catch (error) {
          expect(error).toBeInstanceOf(ZodError);
          const formatted = formatZodError(error as ZodError);
          expect(typeof formatted).toBe("string");
          expect(formatted.length).toBeGreaterThan(0);
        }
      });
    });

    it("should handle complex nested validation errors", () => {
      const complexInvalidInput = {
        testName: "ab", // too short
        testDescription: "", // too short
        testType: "invalid", // invalid enum
        testTaskConfigs: [
          {
            region: "invalid-region", // invalid format
            taskCount: 0, // invalid number
            concurrency: -1, // invalid number
          },
          {
            region: "us-east-1",
            taskCount: "not-a-number", // wrong type
            concurrency: 1,
          },
        ],
        testScenario: {
          execution: [], // empty array
        },
        regionalTaskDetails: {}, // empty object (should require entries)
        tags: ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"], // too many
        scheduleDate: "invalid-date", // invalid format
        scheduleTime: "25:00", // invalid time
        cronValue: "invalid cron", // invalid cron
      };

      try {
        createTestSchema.parse(complexInvalidInput);
        expect(true).toBe(false); // Expected validation to throw for complex invalid input
      } catch (error) {
        const zodError = error as ZodError;
        expect(zodError.issues.length).toBeGreaterThan(5);

        const formatted = formatZodError(zodError);
        expect(formatted).toContain("testName");
        expect(formatted).toContain("testDescription");
        expect(formatted).toContain("testType");
        expect(formatted).toContain("region");
        expect(formatted).toContain("taskCount");

        const grouped = groupZodIssuesByPath(zodError.issues);
        expect(Object.keys(grouped).length).toBeGreaterThan(3);

        const validationErrors = zodIssuesToValidationErrors(zodError.issues);
        expect(validationErrors.length).toBeGreaterThan(5);
      }
    });
  });
});
