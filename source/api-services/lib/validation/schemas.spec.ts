// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  testIdSchema,
  testRunIdSchema,
  pathParametersSchema,
  scenariosQuerySchema,
  scenarioQuerySchema,
  testRunsQuerySchema,
  baselineQuerySchema,
  createTestSchema,
  setBaselineSchema,
  deleteTestRunsSchema,
} from "./schemas";

describe("Validation Schemas", () => {
  describe("testIdSchema", () => {
    it("should validate correct testId formats", () => {
      const validTestIds = [
        "test-123",
        "my-test",
        "TEST123",
        "a",
        "a".repeat(128), // max length
        "test-with-many-hyphens-123",
        "123test",
        "test123test",
      ];

      validTestIds.forEach((testId) => {
        expect(() => testIdSchema.parse(testId)).not.toThrow();
      });
    });

    it("should reject invalid testId formats", () => {
      const invalidTestIds = [
        undefined,
        null,
        "",
        " ",
        "test_underscore",
        "test with spaces",
        "test@special",
        "test.dot",
        "test/slash",
        "test\\backslash",
        "test:colon",
        "a".repeat(129), // exceeds max length
      ];

      invalidTestIds.forEach((testId) => {
        expect(() => testIdSchema.parse(testId)).toThrow();
      });
    });

    it("should provide specific error messages", () => {
      expect(() => testIdSchema.parse("")).toThrow(/testId is required/);
      expect(() => testIdSchema.parse("a".repeat(129))).toThrow(/must not exceed 128 characters/);
      expect(() => testIdSchema.parse("test_invalid")).toThrow(/must contain only alphanumeric characters and hyphens/);
    });
  });

  describe("testRunIdSchema", () => {
    it("should validate correct testRunId formats", () => {
      const validTestRunIds = [
        "run-123",
        "my-run",
        "RUN123",
        "r",
        "r".repeat(128), // max length
        "run-with-many-hyphens-456",
        "123run",
        "run123run",
      ];

      validTestRunIds.forEach((testRunId) => {
        expect(() => testRunIdSchema.parse(testRunId)).not.toThrow();
      });
    });

    it("should reject invalid testRunId formats", () => {
      const invalidTestRunIds = [
        undefined,
        null,
        "",
        " ",
        "run_underscore",
        "run with spaces",
        "run@special",
        "run.dot",
        "r".repeat(129), // exceeds max length
      ];

      invalidTestRunIds.forEach((testRunId) => {
        expect(() => testRunIdSchema.parse(testRunId)).toThrow();
      });
    });
  });

  describe("pathParametersSchema", () => {
    it("should validate correct path parameter combinations", () => {
      const validParams = [
        {},
        { testId: "test-123" },
        { testRunId: "run-123" },
        { testId: "test-123", testRunId: "run-123" },
      ];

      validParams.forEach((params) => {
        expect(() => pathParametersSchema.parse(params)).not.toThrow();
      });
    });

    it("should allow optional parameters", () => {
      const result1 = pathParametersSchema.parse({});
      expect(result1.testId).toBeUndefined();
      expect(result1.testRunId).toBeUndefined();

      const result2 = pathParametersSchema.parse({ testId: "test-123" });
      expect(result2.testId).toBe("test-123");
      expect(result2.testRunId).toBeUndefined();
    });
  });

  describe("scenariosQuerySchema", () => {
    it("should validate correct scenarios query parameters", () => {
      const validQueries = [
        {},
        { op: "listRegions" },
        { tags: "tag1,tag2,tag3" },
        { op: "listRegions", tags: "singleTag" },
      ];

      validQueries.forEach((query) => {
        expect(() => scenariosQuerySchema.parse(query)).not.toThrow();
      });
    });

    it("should reject invalid op values", () => {
      const invalidQueries = [{ op: "invalidOperation" }, { op: "list" }, { op: "" }];

      invalidQueries.forEach((query) => {
        expect(() => scenariosQuerySchema.parse(query)).toThrow();
      });
    });

    it("should reject tags that are too long", () => {
      expect(() => scenariosQuerySchema.parse({ tags: "a".repeat(501) })).toThrow(/Tags parameter too long/);
    });

    it("should reject unknown parameters in strict mode", () => {
      expect(() => scenariosQuerySchema.parse({ unknownParam: "value" })).toThrow();
    });
  });

  describe("scenarioQuerySchema", () => {
    it("should validate correct scenario query parameters", () => {
      const validQueries = [
        {},
        { history: "true" },
        { history: "false" },
        { latest: "true" },
        { latest: "false" },
        { history: "true", latest: "false" },
      ];

      validQueries.forEach((query) => {
        expect(() => scenarioQuerySchema.parse(query)).not.toThrow();
      });
    });

    it("should reject invalid boolean string values", () => {
      const invalidQueries = [
        { history: "yes" },
        { history: "no" },
        { history: "1" },
        { history: "0" },
        { latest: "YES" },
        { latest: "FALSE" },
      ];

      invalidQueries.forEach((query) => {
        expect(() => scenarioQuerySchema.parse(query)).toThrow();
      });
    });
  });

  describe("testRunsQuerySchema", () => {
    it("should validate and transform correct test runs query parameters", () => {
      const query1 = testRunsQuerySchema.parse({ limit: "25" });
      expect(query1.limit).toBe(25);
      expect(typeof query1.limit).toBe("number");

      const query2 = testRunsQuerySchema.parse({
        limit: "50",
        start_timestamp: "2024-01-01T00:00:00Z",
        end_timestamp: "2024-12-31T23:59:59Z",
        latest: "true",
        next_token: "abc123",
      });
      expect(query2.limit).toBe(50);
      expect(query2.start_timestamp).toBe("2024-01-01T00:00:00Z");
    });

    it("should validate limit boundaries", () => {
      expect(() => testRunsQuerySchema.parse({ limit: "0" })).toThrow(/Limit must be between 1 and 100/);
      expect(() => testRunsQuerySchema.parse({ limit: "101" })).toThrow(/Limit must be between 1 and 100/);
      expect(() => testRunsQuerySchema.parse({ limit: "-5" })).toThrow(/Limit must be a number/);
      expect(() => testRunsQuerySchema.parse({ limit: "abc" })).toThrow(/Limit must be a number/);
    });

    it("should validate ISO date formats", () => {
      expect(() => testRunsQuerySchema.parse({ start_timestamp: "invalid-date" })).toThrow(/Invalid date format/);
      expect(() => testRunsQuerySchema.parse({ end_timestamp: "2024-13-01" })).toThrow(/Invalid date format/);
      // Note: 2024/01/01 might be parsed as valid by Date.parse, so testing with clearly invalid format
      expect(() => testRunsQuerySchema.parse({ start_timestamp: "not-a-date" })).toThrow(/Invalid date format/);
    });

    it("should accept valid ISO date formats", () => {
      const validDates = [
        "2024-01-01T00:00:00Z",
        "2024-12-31T23:59:59.999Z",
        "2024-06-15T12:30:45+05:30",
        "2024-02-29T00:00:00-08:00", // leap year
      ];

      validDates.forEach((date) => {
        expect(() => testRunsQuerySchema.parse({ start_timestamp: date })).not.toThrow();
        expect(() => testRunsQuerySchema.parse({ end_timestamp: date })).not.toThrow();
      });
    });
  });

  describe("baselineQuerySchema", () => {
    it("should validate correct baseline query parameters", () => {
      const validQueries = [{}, { data: "true" }, { data: "false" }];

      validQueries.forEach((query) => {
        expect(() => baselineQuerySchema.parse(query)).not.toThrow();
      });
    });

    it("should reject invalid data values", () => {
      const invalidQueries = [{ data: "yes" }, { data: "1" }, { data: "TRUE" }, { data: "" }];

      invalidQueries.forEach((query) => {
        expect(() => baselineQuerySchema.parse(query)).toThrow();
      });
    });
  });

  describe("createTestSchema", () => {
    const validBaseTest = {
      testName: "Valid Test Name",
      testDescription: "Valid test description with sufficient length",
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

    it("should validate minimal valid test creation request", () => {
      expect(() => createTestSchema.parse(validBaseTest)).not.toThrow();
    });

    it("should validate test with all optional fields", () => {
      const fullTest = {
        ...validBaseTest,
        testId: "custom-test-id",
        fileType: "script" as const,
        showLive: true,
        tags: ["tag1", "tag2", "tag3"],
        scheduleStep: "create" as const,
        scheduleDate: "2024-12-31",
        scheduleTime: "23:59",
        recurrence: "weekly" as const,
        cronValue: "0 9 * * 1",
        cronExpiryDate: "2025-12-31",
        eventBridge: "my-event-bridge",
      };

      expect(() => createTestSchema.parse(fullTest)).not.toThrow();
    });

    it("should validate different test types", () => {
      const testTypes = ["simple", "jmeter", "locust", "k6"] as const;

      testTypes.forEach((testType) => {
        const test = { ...validBaseTest, testType };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });
    });

    it("should validate different file types", () => {
      const fileTypes = ["none", "script", "zip"] as const;

      fileTypes.forEach((fileType) => {
        const test = { ...validBaseTest, fileType };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });
    });

    it("should validate region formats", () => {
      const validRegions = ["us-east-1", "us-west-2", "eu-central-1", "ap-southeast-2", "sa-east-1", "ca-central-1"];

      validRegions.forEach((region) => {
        const test = {
          ...validBaseTest,
          testTaskConfigs: [{ region, taskCount: 1, concurrency: 1 }],
          regionalTaskDetails: { [region]: { dltAvailableTasks: 10 } },
        };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });
    });

    it("should reject invalid region formats", () => {
      const invalidRegions = ["us-east", "invalid-region", "us_east_1", "USEAST1", "us-east-1a", "europe-1"];

      invalidRegions.forEach((region) => {
        const test = {
          ...validBaseTest,
          testTaskConfigs: [{ region, taskCount: 1, concurrency: 1 }],
        };
        expect(() => createTestSchema.parse(test)).toThrow(/Invalid region format/);
      });
    });

    it("should validate schedule date and time formats", () => {
      const validDates = ["2024-01-01", "2024-12-31", "2025-06-15"];
      const validTimes = ["00:00", "12:30", "23:59"];

      validDates.forEach((scheduleDate) => {
        const test = { ...validBaseTest, scheduleDate };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });

      validTimes.forEach((scheduleTime) => {
        const test = { ...validBaseTest, scheduleTime };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });
    });

    it("should reject invalid schedule formats", () => {
      const invalidDates = ["2024/01/01", "01-01-2024", "2024-1-1", "2024-13-01"];
      const invalidTimes = ["24:00", "12:60", "1:30"];

      invalidDates.forEach((scheduleDate) => {
        const test = { ...validBaseTest, scheduleDate };
        expect(() => createTestSchema.parse(test)).toThrow();
      });

      invalidTimes.forEach((scheduleTime) => {
        const test = { ...validBaseTest, scheduleTime };
        expect(() => createTestSchema.parse(test)).toThrow();
      });
    });

    it("should validate cron expressions", () => {
      const validCronExpressions = [
        "0 * * * *", // every hour
        "0 9 * * 1", // 9 AM every Monday
        "30 14 * * 5", // 2:30 PM every Friday
        "0 0 1 * *", // midnight on 1st of every month
        "15 6 * * 0", // 6:15 AM every Sunday
      ];

      validCronExpressions.forEach((cronValue) => {
        const test = { ...validBaseTest, cronValue };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });
    });

    it("should reject invalid cron expressions", () => {
      const invalidCronExpressions = [
        "0 * * *", // missing day of week
        "60 * * * *", // invalid minute
        "0 25 * * *", // invalid hour
        "0 0 32 * *", // invalid day
        "0 0 * 13 *", // invalid month
        "invalid cron",
      ];

      invalidCronExpressions.forEach((cronValue) => {
        const test = { ...validBaseTest, cronValue };
        expect(() => createTestSchema.parse(test)).toThrow(/Invalid cron expression/);
      });
    });

    it("should validate tags constraints", () => {
      // Valid tags
      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          tags: ["tag1"],
        })
      ).not.toThrow();

      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          tags: ["tag1", "tag2", "tag3", "tag4", "tag5"],
        })
      ).not.toThrow();

      // Too many tags
      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          tags: ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"],
        })
      ).toThrow(/Maximum 5 tags allowed/);
    });

    it("should validate required field constraints", () => {
      // Test name constraints
      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          testName: "ab",
        })
      ).toThrow(/testName must be at least 3 characters/);

      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          testName: "a".repeat(256),
        })
      ).toThrow(/testName must not exceed 255 characters/);

      // Test description constraints
      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          testDescription: "ab",
        })
      ).toThrow(/testDescription must be at least 3 characters/);

      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          testDescription: "a".repeat(60001),
        })
      ).toThrow(/testDescription must not exceed 60000 characters/);
    });

    it("should validate task configuration constraints", () => {
      // Empty task configs
      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          testTaskConfigs: [],
        })
      ).toThrow(/At least one test task configuration is required/);

      // Invalid task count
      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          testTaskConfigs: [{ region: "us-east-1", taskCount: 0, concurrency: 1 }],
        })
      ).toThrow(/Number must be greater than 0/);

      // Invalid concurrency
      expect(() =>
        createTestSchema.parse({
          ...validBaseTest,
          testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 0 }],
        })
      ).toThrow(/concurrency must be between 1 and 25000/);
    });

    describe("concurrency validation in testTaskConfigs", () => {
      it("should accept valid concurrency values within limits", () => {
        const validConcurrencies = [1, 100, 1000, 5000, 10000, 25000];

        validConcurrencies.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency }],
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should accept string format concurrency values", () => {
        const validConcurrencies = ["1", "100", "5000", "25000"];

        validConcurrencies.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency }],
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should reject concurrency values below minimum", () => {
        const invalidConcurrencies = [0, -1, -100];

        invalidConcurrencies.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency }],
          };
          expect(() => createTestSchema.parse(test)).toThrow(/concurrency must be between 1 and 25000/);
        });
      });

      it("should reject concurrency values above maximum", () => {
        const invalidConcurrencies = [25001, 30000, 50000, 100000];

        invalidConcurrencies.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency }],
          };
          expect(() => createTestSchema.parse(test)).toThrow(/concurrency must be between 1 and 25000/);
        });
      });

      it("should reject invalid string format concurrency values", () => {
        const invalidFormats = ["abc", "12.5", "1e5", ""];

        invalidFormats.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency }],
          };
          expect(() => createTestSchema.parse(test)).toThrow();
        });
      });

      it("should transform string concurrency to number", () => {
        const test = {
          ...validBaseTest,
          testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: "1000" }],
        };
        const result = createTestSchema.parse(test);
        expect(result.testTaskConfigs[0].concurrency).toBe(1000);
        expect(typeof result.testTaskConfigs[0].concurrency).toBe("number");
      });
    });

    describe("concurrency validation in testScenario execution", () => {
      it("should accept valid concurrency values within limits", () => {
        const validConcurrencies = [1, 100, 1000, 5000, 10000, 25000];

        validConcurrencies.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ concurrency, "hold-for": "1m" }],
            },
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should accept optional concurrency (undefined)", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "hold-for": "1m" }],
          },
        };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });

      it("should reject concurrency values below minimum", () => {
        const invalidConcurrencies = [0, -1, -100];

        invalidConcurrencies.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ concurrency, "hold-for": "1m" }],
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(/concurrency must be between 1 and 25000/);
        });
      });

      it("should reject concurrency values above maximum", () => {
        const invalidConcurrencies = [25001, 30000, 50000, 100000];

        invalidConcurrencies.forEach((concurrency) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ concurrency, "hold-for": "1m" }],
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(/concurrency must be between 1 and 25000/);
        });
      });

      it("should handle both string and number formats", () => {
        // Number format
        const test1 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ concurrency: 1000, "hold-for": "1m" }],
          },
        };
        expect(() => createTestSchema.parse(test1)).not.toThrow();

        // String format
        const test2 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ concurrency: "1000", "hold-for": "1m" }],
          },
        };
        const result = createTestSchema.parse(test2);
        expect(result.testScenario.execution[0].concurrency).toBe(1000);
        expect(typeof result.testScenario.execution[0].concurrency).toBe("number");
      });
    });

    describe("ramp-up validation with suffix-based limits", () => {
      it("should accept valid ramp-up values within limits for each suffix", () => {
        const validRampUps = [
          "0s",
          "30s",
          "3600s", // max seconds
          "0m",
          "30m",
          "1440m", // max minutes
          "0h",
          "5h",
          "168h", // max hours
          "0d",
          "7d",
          "30d", // max days
        ];

        validRampUps.forEach((rampUp) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ "ramp-up": rampUp, "hold-for": "1m" }],
            },
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should accept numeric ramp-up values for backward compatibility", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "ramp-up": 0, "hold-for": "1m" }],
          },
        };
        expect(() => createTestSchema.parse(test)).not.toThrow();

        const test2 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "ramp-up": 120, "hold-for": "1m" }],
          },
        };
        expect(() => createTestSchema.parse(test2)).not.toThrow();
      });

      it("should reject ramp-up values exceeding limits for each suffix", () => {
        const invalidRampUps = [
          { value: "3601s", expectedError: /exceeds maximum of 3600 seconds/ },
          { value: "5000s", expectedError: /exceeds maximum of 3600 seconds/ },
          { value: "1441m", expectedError: /exceeds maximum of 1440 minutes/ },
          { value: "2000m", expectedError: /exceeds maximum of 1440 minutes/ },
          { value: "169h", expectedError: /exceeds maximum of 168 hours/ },
          { value: "500h", expectedError: /exceeds maximum of 168 hours/ },
          { value: "31d", expectedError: /exceeds maximum of 30 days/ },
          { value: "365d", expectedError: /exceeds maximum of 30 days/ },
        ];

        invalidRampUps.forEach(({ value, expectedError }) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ "ramp-up": value, "hold-for": "1m" }],
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(expectedError);
        });
      });

      it("should reject negative numeric ramp-up values", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "ramp-up": -1, "hold-for": "1m" }],
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/must be a non-negative number/);
      });

      it("should reject invalid ramp-up format", () => {
        const invalidFormats = ["10", "10ms", "10sec", "10 s", "10seconds", "abc"];

        invalidFormats.forEach((format) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ "ramp-up": format, "hold-for": "1m" }],
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow();
        });
      });
    });

    describe("hold-for validation with suffix-based limits", () => {
      it("should accept valid hold-for values within limits for each suffix", () => {
        const validHoldFors = [
          "1s",
          "30s",
          "3600s", // max seconds
          "1m",
          "30m",
          "1440m", // max minutes
          "1h",
          "5h",
          "168h", // max hours
          "1d",
          "7d",
          "30d", // max days
        ];

        validHoldFors.forEach((holdFor) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ "hold-for": holdFor }],
            },
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should accept numeric hold-for values for backward compatibility", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "hold-for": 1 }],
          },
        };
        expect(() => createTestSchema.parse(test)).not.toThrow();

        const test2 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "hold-for": 120 }],
          },
        };
        expect(() => createTestSchema.parse(test2)).not.toThrow();
      });

      it("should reject hold-for values exceeding limits for each suffix", () => {
        const invalidHoldFors = [
          { value: "3601s", expectedError: /exceeds maximum of 3600 seconds/ },
          { value: "5000s", expectedError: /exceeds maximum of 3600 seconds/ },
          { value: "1441m", expectedError: /exceeds maximum of 1440 minutes/ },
          { value: "2000m", expectedError: /exceeds maximum of 1440 minutes/ },
          { value: "169h", expectedError: /exceeds maximum of 168 hours/ },
          { value: "500h", expectedError: /exceeds maximum of 168 hours/ },
          { value: "31d", expectedError: /exceeds maximum of 30 days/ },
          { value: "365d", expectedError: /exceeds maximum of 30 days/ },
        ];

        invalidHoldFors.forEach(({ value, expectedError }) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ "hold-for": value }],
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(expectedError);
        });
      });

      it("should reject zero or negative numeric hold-for values", () => {
        const test1 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "hold-for": 0 }],
          },
        };
        expect(() => createTestSchema.parse(test1)).toThrow(/Number must be greater than 0/);

        const test2 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "hold-for": -1 }],
          },
        };
        expect(() => createTestSchema.parse(test2)).toThrow(/Number must be greater than 0/);
      });

      it("should reject invalid hold-for format", () => {
        const invalidFormats = ["10", "10ms", "10sec", "10 m", "10minutes", "xyz"];

        invalidFormats.forEach((format) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              ...validBaseTest.testScenario,
              execution: [{ "hold-for": format }],
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow();
        });
      });

      it("should reject zero values for hold-for in both string and numeric formats", () => {
        // 0s string format should be rejected
        const test1 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "hold-for": "0s" }],
          },
        };
        expect(() => createTestSchema.parse(test1)).toThrow(/hold-for must be greater than 0/);

        // 0 as numeric should also be rejected
        const test2 = {
          ...validBaseTest,
          testScenario: {
            ...validBaseTest.testScenario,
            execution: [{ "hold-for": 0 }],
          },
        };
        expect(() => createTestSchema.parse(test2)).toThrow(/Number must be greater than 0/);
      });
    });
  });

  describe("setBaselineSchema", () => {
    it("should validate correct set baseline request", () => {
      const validBody = { testRunId: "run-123" };
      expect(() => setBaselineSchema.parse(validBody)).not.toThrow();
    });

    it("should reject missing testRunId", () => {
      expect(() => setBaselineSchema.parse({})).toThrow();
    });

    it("should reject invalid testRunId format", () => {
      expect(() => setBaselineSchema.parse({ testRunId: "" })).toThrow();
      expect(() => setBaselineSchema.parse({ testRunId: "invalid_run" })).toThrow();
    });

    it("should reject extra fields in strict mode", () => {
      expect(() =>
        setBaselineSchema.parse({
          testRunId: "run-123",
          extraField: "not allowed",
        })
      ).toThrow();
    });
  });

  describe("deleteTestRunsSchema", () => {
    it("should validate correct delete test runs request", () => {
      const validBodies = [["run-123"], ["run-123", "run-456"], ["run-123", "run-456", "run-789"]];

      validBodies.forEach((body) => {
        expect(() => deleteTestRunsSchema.parse(body)).not.toThrow();
      });
    });

    it("should reject empty array", () => {
      expect(() => deleteTestRunsSchema.parse([])).toThrow(/At least one testRunId is required/);
    });

    it("should reject invalid testRunId formats in array", () => {
      expect(() => deleteTestRunsSchema.parse([""])).toThrow();
      expect(() => deleteTestRunsSchema.parse(["invalid_run"])).toThrow();
      expect(() => deleteTestRunsSchema.parse(["run-123", ""])).toThrow();
    });

    it("should reject non-array input", () => {
      expect(() => deleteTestRunsSchema.parse("run-123")).toThrow();
      expect(() => deleteTestRunsSchema.parse({ testRunId: "run-123" })).toThrow();
    });
  });

  describe("Security Enhancements", () => {
    const validBaseTest = {
      testName: "Valid Test Name",
      testDescription: "Valid test description with sufficient length",
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
            scenario: "test-scenario",
          },
        ],
        scenarios: {
          "test-scenario": {
            requests: [
              {
                url: "https://example.com/api",
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

    describe("testName special characters validation", () => {
      it("should accept valid testName with alphanumeric, spaces, hyphens, underscores, and parentheses", () => {
        const validNames = [
          "Simple Test",
          "test-with-hyphens",
          "test_with_underscores",
          "Test123",
          "123Test",
          "Test-123_Name",
          "a b c",
          "Simple Test (Copy)",
          "test(paren)",
          "Test (1)",
        ];

        validNames.forEach((testName) => {
          const test = { ...validBaseTest, testName };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should reject testName with special characters that break UI", () => {
        const invalidNames = [
          "!\"#$%&/='.,:;-_{}",
          "test@example.com",
          "test.with.dots",
          "test/with/slashes",
          "test\\with\\backslashes",
          "test:colon",
          "test;semicolon",
          "test,comma",
          "test<bracket>",
          "test[bracket]",
          "test{brace}",
          "test'quote",
          'test"doublequote',
          "test!exclamation",
          "test?question",
          "test*asterisk",
          "test+plus",
          "test=equals",
          "test&ampersand",
        ];

        invalidNames.forEach((testName) => {
          const test = { ...validBaseTest, testName };
          expect(() => createTestSchema.parse(test)).toThrow(
            /testName can only contain letters, numbers, spaces, hyphens, underscores, and parentheses/
          );
        });
      });
    });

    describe("scenarios object structure validation", () => {
      it("should reject empty scenarios object", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {},
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/At least one scenario must be defined in scenarios object/);
      });

      it("should accept valid scenario names", () => {
        const validScenarioNames = [
          "simple-scenario",
          "scenario_with_underscores",
          "scenario123",
          "UPPERCASE",
          "MixedCase",
          "a",
          "a".repeat(128), // max length
          "Demo Day Test",
          "api test",
          "load test 1",
          "My Test Scenario",
          "Simple Test (Copy)",
          "scenario(with)parens",
          "Test (1)",
        ];

        validScenarioNames.forEach((scenarioName) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m", scenario: scenarioName }],
              scenarios: {
                [scenarioName]: {
                  requests: [{ url: "https://example.com", method: "GET" }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should reject invalid scenario names", () => {
        const invalidScenarioNames = ["", "scenario.dot", "scenario@special", "scenario/slash", "scenario:colon"];

        invalidScenarioNames.forEach((scenarioName) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m" }],
              scenarios: {
                [scenarioName]: {
                  requests: [{ url: "https://example.com", method: "GET" }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(
            /Scenario name can only contain letters, numbers, spaces, hyphens, underscores, and parentheses/
          );
        });
      });

      it("should reject scenario names that are only whitespace", () => {
        const whitespaceOnlyNames = [" ", "  ", "   "];

        whitespaceOnlyNames.forEach((scenarioName) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m" }],
              scenarios: {
                [scenarioName]: {
                  requests: [{ url: "https://example.com", method: "GET" }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(/Scenario name cannot be only whitespace/);
        });
      });

      it("should reject scenario names exceeding maximum length", () => {
        const scenarioName = "a".repeat(129); // exceeds max length
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {
              [scenarioName]: {
                requests: [{ url: "https://example.com", method: "GET" }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/Scenario name must not exceed 128 characters/);
      });

      it("should require at least one request per scenario when requests field is present", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {
              "test-scenario": {
                requests: [],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/Each scenario must have at least one request/);
      });

      it("should accept scenarios with script field for file-based executors", () => {
        const testWithScript = {
          ...validBaseTest,
          testType: "k6" as const,
          testScenario: {
            execution: [{ "hold-for": "1m", scenario: "k6-test", executor: "k6" }],
            scenarios: {
              "k6-test": {
                script: "test.js",
              },
            },
          },
        };
        expect(() => createTestSchema.parse(testWithScript)).not.toThrow();
      });

      it("should accept scenarios with script field and spaces in name", () => {
        const testWithScript = {
          ...validBaseTest,
          testType: "k6" as const,
          testScenario: {
            execution: [{ "hold-for": "5m", scenario: "Demo Day Test", executor: "k6" }],
            scenarios: {
              "Demo Day Test": {
                script: "nQdT2IwMWZ.js",
              },
            },
          },
        };
        expect(() => createTestSchema.parse(testWithScript)).not.toThrow();
      });

      it("should limit requests to 100 per scenario", () => {
        const requests = Array(101)
          .fill(null)
          .map(() => ({ url: "https://example.com", method: "GET" }));

        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {
              "test-scenario": {
                requests,
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/Each scenario cannot exceed 100 requests/);
      });
    });

    describe("URL validation in scenario requests", () => {
      it("should accept valid HTTP and HTTPS URLs", () => {
        const validUrls = [
          "https://example.com",
          "http://example.com",
          "https://api.example.com/v1/endpoint",
          "https://example.com:8080/path",
          "https://subdomain.example.com/path?query=value",
          "https://example.com/path#fragment",
          "https://user:pass@example.com",
          "https://192.168.1.1",
        ];

        validUrls.forEach((url) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m" }],
              scenarios: {
                "test-scenario": {
                  requests: [{ url, method: "GET" }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should reject invalid URL formats", () => {
        const invalidUrls = [
          "",
          "not-a-url",
          "ftp://example.com",
          "file:///path/to/file",
          "javascript:alert(1)",
          "example.com",
          "www.example.com",
        ];

        invalidUrls.forEach((url) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m" }],
              scenarios: {
                "test-scenario": {
                  requests: [{ url, method: "GET" }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(/url must be a valid HTTP\/HTTPS URL/);
        });
      });

      it("should enforce URL length limit of 2048 characters", () => {
        const longUrl = "https://example.com/" + "a".repeat(2030); // total > 2048
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {
              "test-scenario": {
                requests: [{ url: longUrl, method: "GET" }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/url must not exceed 2048 characters/);
      });

      it("should accept URL at maximum length", () => {
        const maxLengthUrl = "https://example.com/" + "a".repeat(2048 - "https://example.com/".length);
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {
              "test-scenario": {
                requests: [{ url: maxLengthUrl, method: "GET" }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });
    });

    describe("HTTP method validation in scenario requests", () => {
      it("should accept valid HTTP methods", () => {
        const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

        validMethods.forEach((method) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m" }],
              scenarios: {
                "test-scenario": {
                  requests: [{ url: "https://example.com", method }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should reject invalid HTTP methods", () => {
        const invalidMethods = ["", "get", "INVALID", "CONNECT", "TRACE", "123", "GET POST"];

        invalidMethods.forEach((method) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m" }],
              scenarios: {
                "test-scenario": {
                  requests: [{ url: "https://example.com", method }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).toThrow(/method must be a valid HTTP method/);
        });
      });
    });

    describe("request body size validation", () => {
      it("should accept request body within size limit", () => {
        const validBodies = ["", "small body", "x".repeat(1000), "x".repeat(65536)];

        validBodies.forEach((body) => {
          const test = {
            ...validBaseTest,
            testScenario: {
              execution: [{ "hold-for": "1m" }],
              scenarios: {
                "test-scenario": {
                  requests: [{ url: "https://example.com", method: "POST", body }],
                },
              },
            },
          };
          expect(() => createTestSchema.parse(test)).not.toThrow();
        });
      });

      it("should reject request body exceeding size limit", () => {
        const largeBody = "x".repeat(65537);
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {
              "test-scenario": {
                requests: [{ url: "https://example.com", method: "POST", body: largeBody }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/body must not exceed 65536 characters/);
      });
    });

    describe("cross-validation between execution and scenarios", () => {
      it("should validate when execution references existing scenarios", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [
              { "hold-for": "1m", scenario: "scenario-1" },
              { "hold-for": "2m", scenario: "scenario-2" },
            ],
            scenarios: {
              "scenario-1": {
                requests: [{ url: "https://example.com", method: "GET" }],
              },
              "scenario-2": {
                requests: [{ url: "https://api.example.com", method: "POST" }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });

      it("should allow execution without scenario reference", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m" }],
            scenarios: {
              "test-scenario": {
                requests: [{ url: "https://example.com", method: "GET" }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).not.toThrow();
      });

      it("should reject when execution references non-existent scenario", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [{ "hold-for": "1m", scenario: "non-existent-scenario" }],
            scenarios: {
              "existing-scenario": {
                requests: [{ url: "https://example.com", method: "GET" }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/doesn't exist in scenarios object/);
      });

      it("should reject when one of multiple execution entries references non-existent scenario", () => {
        const test = {
          ...validBaseTest,
          testScenario: {
            execution: [
              { "hold-for": "1m", scenario: "scenario-1" },
              { "hold-for": "2m", scenario: "non-existent" },
            ],
            scenarios: {
              "scenario-1": {
                requests: [{ url: "https://example.com", method: "GET" }],
              },
            },
          },
        };
        expect(() => createTestSchema.parse(test)).toThrow(/doesn't exist in scenarios object/);
      });
    });

    describe("combined security validations", () => {
      it("should reject test with multiple security violations", () => {
        const test = {
          ...validBaseTest,
          testName: "invalid@name",
          testTaskConfigs: [
            {
              region: "us-east-1",
              taskCount: 1,
              concurrency: 999999999999999, // excessive concurrency
            },
          ],
          testScenario: {
            execution: [{ "hold-for": "9999999999m", scenario: "scenario-1" }], // excessive hold-for
            scenarios: {}, // empty scenarios
          },
        };

        expect(() => createTestSchema.parse(test)).toThrow();
      });

      it("should accept fully compliant test configuration", () => {
        const compliantTest = {
          testName: "Compliant Test Name",
          testDescription: "Fully compliant test configuration following all security requirements",
          testType: "simple" as const,
          testTaskConfigs: [
            {
              region: "us-east-1",
              taskCount: 5,
              concurrency: 100,
            },
          ],
          testScenario: {
            execution: [
              {
                "ramp-up": "30s",
                "hold-for": "2m",
                scenario: "api-test",
              },
            ],
            scenarios: {
              "api-test": {
                requests: [
                  {
                    url: "https://api.example.com/v1/users",
                    method: "GET",
                    headers: { Authorization: "Bearer token" },
                  },
                  {
                    url: "https://api.example.com/v1/users",
                    method: "POST",
                    body: '{"name":"John"}',
                    headers: { "Content-Type": "application/json" },
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

        expect(() => createTestSchema.parse(compliantTest)).not.toThrow();
      });
    });
  });
});
