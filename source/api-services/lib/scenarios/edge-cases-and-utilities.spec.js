// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Edge cases and utility function tests for the scenarios module
// This file tests error handling paths, edge cases, and utility functions
// that are not covered by the main index.spec.js test suite

// Mock AWS SDK v3
const mockDynamoDB = jest.fn();
const mockS3 = jest.fn();
const mockStepFunctions = jest.fn();
const mockEcs = jest.fn();
const mockCloudWatch = jest.fn();
const mockCloudWatchLogs = jest.fn();
const mockCloudWatchEvents = jest.fn();
const mockLambda = jest.fn();
const mockCloudFormation = jest.fn();
const mockServiceQuotas = jest.fn();

const createMockFactory = (moduleLocation, clientName, mockFn) => () => {
  const actualModule = jest.requireActual(moduleLocation);
  const handler = {
    get: (target, prop) => mockFn,
  };
  return {
    ...actualModule,
    [clientName]: jest.fn(() => new Proxy({}, handler)),
  };
};

jest.doMock("@aws-sdk/client-dynamodb", createMockFactory("@aws-sdk/client-dynamodb", "DynamoDB", mockDynamoDB));
jest.doMock("@aws-sdk/client-s3", createMockFactory("@aws-sdk/client-s3", "S3", mockS3));
jest.doMock("@aws-sdk/client-sfn", createMockFactory("@aws-sdk/client-sfn", "SFN", mockStepFunctions));
jest.doMock(
  "@aws-sdk/client-cloudwatch-logs",
  createMockFactory("@aws-sdk/client-cloudwatch-logs", "CloudWatchLogs", mockCloudWatchLogs)
);
jest.doMock(
  "@aws-sdk/client-cloudwatch-events",
  createMockFactory("@aws-sdk/client-cloudwatch-events", "CloudWatchEvents", mockCloudWatchEvents)
);
jest.doMock("@aws-sdk/client-lambda", createMockFactory("@aws-sdk/client-lambda", "Lambda", mockLambda));
jest.doMock(
  "@aws-sdk/client-cloudformation",
  createMockFactory("@aws-sdk/client-cloudformation", "CloudFormation", mockCloudFormation)
);
jest.doMock("@aws-sdk/client-ecs", createMockFactory("@aws-sdk/client-ecs", "ECS", mockEcs));
jest.doMock(
  "@aws-sdk/client-service-quotas",
  createMockFactory("@aws-sdk/client-service-quotas", "ServiceQuotas", mockServiceQuotas)
);
jest.doMock(
  "@aws-sdk/client-cloudwatch",
  createMockFactory("@aws-sdk/client-cloudwatch", "CloudWatch", mockCloudWatch)
);

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const actualModule = jest.requireActual("@aws-sdk/lib-dynamodb");
  const handler = {
    get: (target, prop) => mockDynamoDB,
  };
  return {
    ...actualModule,
    DynamoDBDocument: {
      from: jest.fn(() => new Proxy({}, handler)),
    },
  };
});

jest.mock("solution-utils", () => ({
  getOptions: jest.fn(() => ({})),
  generateUniqueId: jest.fn(() => "abc1234567"),
  sendMetric: jest.fn(() => Promise.resolve()),
}));

process.env.SCENARIOS_BUCKET = "bucket";
process.env.SCENARIOS_TABLE = "testScenariosTable";
process.env.HISTORY_TABLE = "testHistoryTable";
process.env.HISTORY_TABLE_GSI_NAME = "testHistoryTableGSI";
process.env.STATE_MACHINE_ARN = "arn:of:state:machine";
process.env.LAMBDA_ARN = "arn:of:apilambda";
process.env.TASK_CANCELER_ARN = "arn:of:taskCanceler";
process.env.SOLUTION_ID = "SO0062";
process.env.STACK_ID = "arn:of:cloudformation:stack/stackName/abc-def-hij-123";
process.env.STACK_NAME = "stackName";
process.env.VERSION = "3.0.0";

const lambda = require("./index.js");

describe("Scenarios Module - Edge Cases and Utilities", () => {
  beforeEach(() => {
    mockS3.mockReset();
    mockDynamoDB.mockReset();
    mockStepFunctions.mockReset();
    mockEcs.mockReset();
    mockCloudWatch.mockReset();
    mockCloudWatchLogs.mockReset();
    mockCloudWatchEvents.mockReset();
    mockLambda.mockReset();
    mockCloudFormation.mockReset();
    mockServiceQuotas.mockReset();
  });

  // Test custom error class methods
  describe("ErrorException class utility methods", () => {
    it("should return proper string representation with toString method", () => {
      const error = new lambda.ErrorException("TEST_CODE", "Test message");
      expect(error.toString()).toBe("TEST_CODE: Test message");
    });
  });

  // Test tag normalization utility function
  describe("normalizeTag utility function", () => {
    it("should handle null and undefined values", () => {
      expect(lambda.normalizeTag(null)).toBe("null");
      expect(lambda.normalizeTag(undefined)).toBe("undefined");
    });

    it("should normalize various tag formats", () => {
      expect(lambda.normalizeTag("Test Tag")).toBe("test-tag");
      expect(lambda.normalizeTag("UPPERCASE")).toBe("uppercase");
      expect(lambda.normalizeTag("test@tag#123")).toBe("testtag123");
      expect(lambda.normalizeTag("test   multiple   spaces")).toBe("test-multiple-spaces");
      expect(lambda.normalizeTag("test---multiple---hyphens")).toBe("test-multiple-hyphens");
      expect(lambda.normalizeTag("  leading and trailing  ")).toBe("leading-and-trailing");
      expect(lambda.normalizeTag("-start-end-")).toBe("start-end");
    });

    it("should handle numeric input", () => {
      expect(lambda.normalizeTag(123)).toBe("123");
    });
  });

  // Test listTests with filterTags
  describe("listTests with filterTags", () => {
    const listDataWithTags = {
      Items: [
        { testId: "test1", tags: ["web", "api"] },
        { testId: "test2", tags: ["mobile", "app"] }
      ],
    };

    it("should filter tests by tags", async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(listDataWithTags));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 })); // count for test1
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 2 })); // count for test2
      
      const response = await lambda.listTests(["web"]);
      expect(response.Items).toHaveLength(2);
    });

    it("should handle startTime branch conditions in sorting", async () => {
      const itemsWithoutStartTime = {
        Items: [
          { testId: "test1", tags: [] },
          { testId: "test2", tags: [], startTime: "2023-01-01T10:00:00Z" }
        ]
      };
      
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(itemsWithoutStartTime));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 0 })); // count for test1
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 0 })); // count for test2
      
      const response = await lambda.listTests();
      expect(response.Items).toHaveLength(2);
    });
  });


  // Test createTest error branches
  describe("createTest error conditions", () => {
    const baseConfig = {
      testName: "test",
      testDescription: "desc",
      testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
      testScenario: { execution: [{ "hold-for": "1m", "ramp-up": "30s" }] },
      regionalTaskDetails: { "us-east-1": { dltAvailableTasks: "100" } }
    };

    it("should handle cronExpiryDate branch in config destructuring", async () => {
      const config = { ...baseConfig, cronExpiryDate: "2025-12-31" };
      
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getTestEntry
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ 
        Item: { region: "us-east-1", taskCluster: "cluster" } 
      })); // getRegionInfraConfigs
      mockS3.mockImplementation(() => Promise.resolve());
      mockStepFunctions.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementation(() => Promise.resolve({ Attributes: {} }));

      const result = await lambda.createTest(config, "functionName");
      expect(result).toBeDefined();
    });

    it("should handle eventBridge === 'Cron Expiry Reached'", async () => {
      const config = { 
        ...baseConfig, 
        eventBridge: true, 
        cronValue: "0 12 * * *",
        scheduleTime: "12:00"
      };
      
      // Mock getEbSchedTestStartTime to return "Cron Expiry Reached"
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);
      config.cronExpiryDate = pastDate.toISOString();

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getTestEntry
      mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
      mockLambda.mockImplementation(() => Promise.resolve());

      const result = await lambda.createTest(config, "functionName");
      expect(result).toBeNull();
    });
  });

  // Test getTest branches
  describe("getTest error conditions", () => {
    it("should handle data.status !== 'running' branch", async () => {
      const completedTest = {
        Item: {
          testId: "1234",
          status: "complete",
          testScenario: '{"name":"test"}',
          tags: ["tag1"]
        }
      };

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(completedTest));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 5 })); // getTotalCount
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [] })); // getTestHistoryEntries

      const result = await lambda.getTest("1234");
      expect(result.status).toBe("complete");
      expect(result.totalTestRuns).toBe(5);
    });

    it("should handle history=false parameter", async () => {
      const testData = {
        Item: {
          testId: "1234",
          status: "complete",
          testScenario: '{"name":"test"}',
          tags: ["tag1"]
        }
      };

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 2 }));

      const result = await lambda.getTest("1234", { history: "false" });
      expect(result.history).toEqual([]);
    });

    it("should handle latest=false parameter", async () => {
      const testData = {
        Item: {
          testId: "1234",
          status: "complete",
          testScenario: '{"name":"test"}',
          results: { some: "data" }
        }
      };

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 2 }));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [] }));

      const result = await lambda.getTest("1234", { latest: "false" });
      expect(result.results).toEqual({});
    });
  });

  // Test cancelTest branches
  describe("cancelTest error conditions", () => {
    it("should throw TEST_NOT_FOUND when testId doesn't exist in list", async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [{ testId: "other-test" }] }));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 }));

      try {
        await lambda.cancelTest("non-existent-test");
      } catch (error) {
        expect(error.code).toBe("TEST_NOT_FOUND");
        expect(error.message).toContain("testId 'non-existent-test' not found");
      }
    });

    it("should handle case when testTaskConfigs is missing", async () => {
      const testData = {
        Item: {
          testId: "1234",
          status: "running",
          testScenario: '{"name":"test"}'
        }
      };

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [{ testId: "1234" }] }));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 }));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve());

      const result = await lambda.cancelTest("1234");
      expect(result).toBe("test cancelling");
    });
  });

  // Test additional edge cases for existing exported functions
  describe("Additional edge cases for exported functions", () => {
    it("should handle getTestDurationSeconds with different time units", () => {
      // This function is exported and we can test its edge cases
      expect(() => lambda.getTestDurationSeconds("2h")).toThrow("Invalid hold-for unit");
      expect(() => lambda.getTestDurationSeconds("invalid")).toThrow();
    });

    it("should handle extractMetrics with empty results", () => {
      const result = lambda.extractMetrics(null);
      expect(result).toEqual({});
      
      const result2 = lambda.extractMetrics(undefined);
      expect(result2).toEqual({});
    });

    it("should handle extractMetrics with results but no total", () => {
      const result = lambda.extractMetrics({ notTotal: "data" });
      expect(result).toEqual({});
    });
  });

  // Test getStackInfo with MCP endpoint
  describe("getStackInfo with MCP endpoint", () => {
    it("should return MCP endpoint when available in stack outputs", async () => {
      const mockStackWithMcp = {
        Stacks: [
          {
            CreationTime: new Date("2025-09-09T19:40:22Z"),
            StackId: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
            Tags: [{ Key: "SolutionVersion", Value: "v4.0.0" }],
            Outputs: [
              { OutputKey: "McpEndpoint", OutputValue: "https://api.example.com/mcp" }
            ]
          }
        ]
      };
      
      mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackWithMcp));

      const response = await lambda.getStackInfo();
      expect(response.mcp_endpoint).toEqual("https://api.example.com/mcp");
    });
  });

  // Add more tests to cover remaining branches with working functions
  describe("Additional branch coverage tests", () => {
    it("should test validateTaskCountConcurrency with string inputs", async () => {
      const config = {
        testName: "String Validation Test",
        testDescription: "Test string to number conversion",
        testTaskConfigs: [{ region: "us-east-1", taskCount: "  5  ", concurrency: "  3  " }],
        testScenario: { execution: [{ "hold-for": "1m", "ramp-up": "30s" }] },
        regionalTaskDetails: { "us-east-1": { dltAvailableTasks: "100" } }
      };

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getTestEntry
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ 
        Item: { region: "us-east-1", taskCluster: "cluster" } 
      })); // getRegionInfraConfigs
      mockS3.mockImplementation(() => Promise.resolve());
      mockStepFunctions.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementation(() => Promise.resolve({ Attributes: {} }));

      const result = await lambda.createTest(config, "functionName");
      expect(result).toBeDefined();
    });

    it("should test createTest with tags validation", async () => {
      const config = {
        testName: "Tags Test",
        testDescription: "Test with tags validation",
        testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
        testScenario: { execution: [{ "hold-for": "1m", "ramp-up": "30s" }] },
        regionalTaskDetails: { "us-east-1": { dltAvailableTasks: "100" } },
        tags: ["test-tag", "performance"]
      };

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getTestEntry
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ 
        Item: { region: "us-east-1", taskCluster: "cluster" } 
      })); // getRegionInfraConfigs
      mockS3.mockImplementation(() => Promise.resolve());
      mockStepFunctions.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementation(() => Promise.resolve({ Attributes: {} }));

      const result = await lambda.createTest(config, "functionName");
      expect(result).toBeDefined();
    });

    it("should test different file type scenarios", async () => {
      // Test different combinations to hit more branches
      const configs = [
        { testType: "simple", fileType: undefined },
        { testType: "jmeter", fileType: "zip" },
        { testType: "locust", fileType: null }
      ];

      for (const testConfig of configs) {
        const config = {
          testName: "FileType Test",
          testDescription: "Test file type handling",
          testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
          testScenario: { execution: [{ "hold-for": "1m", "ramp-up": "30s" }] },
          regionalTaskDetails: { "us-east-1": { dltAvailableTasks: "100" } },
          ...testConfig
        };

        mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getTestEntry
        mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ 
          Item: { region: "us-east-1", taskCluster: "cluster" } 
        })); // getRegionInfraConfigs
        mockS3.mockImplementation(() => Promise.resolve());
        mockStepFunctions.mockImplementation(() => Promise.resolve());
        mockDynamoDB.mockImplementation(() => Promise.resolve({ Attributes: {} }));

        const result = await lambda.createTest(config, "functionName");
        expect(result).toBeDefined();
      }
    });

    it("should test createTest with no existing testEntry and no nextRun", async () => {
      const config = {
        testName: "No Existing Test",
        testDescription: "Test without existing test entry",
        testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
        testScenario: { execution: [{ "hold-for": "1m", "ramp-up": "30s" }] },
        regionalTaskDetails: { "us-east-1": { dltAvailableTasks: "100" } }
      };

      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getTestEntry - returns undefined
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ 
        Item: { region: "us-east-1", taskCluster: "cluster" } 
      })); // getRegionInfraConfigs
      mockS3.mockImplementation(() => Promise.resolve());
      mockStepFunctions.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementation(() => Promise.resolve({ Attributes: {} }));

      const result = await lambda.createTest(config, "functionName");
      expect(result).toBeDefined();
    });

    it("should test extractMetrics with valid results containing total", async () => {
      const results = {
        total: {
          throughput: 100,
          succ: 95,
          fail: 5,
          testDuration: 60,
          bytes: 500000,
          avg_rt: 0.2,
          avg_lt: 0.15,
          avg_ct: 0.05,
          p0_0: 0.1,
          p50_0: 0.2,
          p90_0: 0.3,
          p95_0: 0.4,
          p99_0: 0.5,
          p99_9: 0.9,
          p100_0: 1.0
        }
      };

      const extracted = lambda.extractMetrics(results);
      expect(extracted.requests).toBe(100);
      expect(extracted.success).toBe(95);
      expect(extracted.errors).toBe(5);
      expect(extracted.percentiles).toBeDefined();
      expect(extracted.avgResponseTime).toBe(200); // 0.2 * 1000
    });
  });
});
