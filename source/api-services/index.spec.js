// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Set up environment variables before any imports
process.env.AWS_REGION = "us-east-1";
process.env.AWS_DEFAULT_REGION = "us-east-1";
process.env.METRICS_ENDPOINT = "https://test.metrics.com";
process.env.SEND_METRIC = "Yes";

// Mock the scenarios module before importing
jest.mock("./lib/scenarios/", () => ({
  ErrorException: jest.fn().mockImplementation((code, message, statusCode) => ({
    code,
    message,
    statusCode,
    toString: () => message,
  })),
  StatusCodes: {
    BAD_REQUEST: 400,
    NOT_ALLOWED: 405,
  },
  listTests: jest.fn().mockResolvedValue([]),
  getTest: jest.fn().mockResolvedValue({}),
  cancelTest: jest.fn().mockResolvedValue("success"),
  createTest: jest.fn().mockResolvedValue({}),
  deleteTest: jest.fn().mockResolvedValue("success"),
  scheduleTest: jest.fn().mockResolvedValue({}),
  listTasks: jest.fn().mockResolvedValue([]),
  getAccountFargatevCPUDetails: jest.fn().mockResolvedValue({}),
  getAllRegionConfigs: jest.fn().mockResolvedValue([]),
  getCFUrl: jest.fn().mockResolvedValue(""),
  getTestRuns: jest.fn().mockResolvedValue({}),
  deleteTestRuns: jest.fn().mockResolvedValue({}),
  getTestRun: jest.fn().mockResolvedValue({}),
  getBaseline: jest.fn().mockResolvedValue({}),
  setBaseline: jest.fn().mockResolvedValue("success"),
  clearBaseline: jest.fn().mockResolvedValue("success"),
  getStackInfo: jest.fn().mockResolvedValue({}),
}));

jest.mock("solution-utils", () => ({
  sendMetric: jest.fn().mockResolvedValue(undefined),
}));

const apiServices = require("./index");
const scenarios = require("./lib/scenarios/");

describe("validateConfig", () => {
  const validateConfig = apiServices.validateConfig;

  it("should validate a correct config object without throwing an error", () => {
    const validConfig = {
      testId: "test-123",
      testName: "Test Name",
      testDescription: "Test Description",
      testTaskConfigs: [{ region: "us-east-1" }],
      testScenario: { execution: [] },
      showLive: true,
      testType: "simple",
      fileType: "none",
      regionalTaskDetails: { "us-east-1": {} },
    };

    // This should not throw an error
    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  it("should throw an error for invalid testId type", () => {
    const invalidConfig = {
      testId: 123, // Should be a string
      testName: "Test Name",
      testDescription: "Test Description",
      testTaskConfigs: [{ region: "us-east-1" }],
      testScenario: { execution: [] },
      showLive: true,
      testType: "simple",
      fileType: "none",
      regionalTaskDetails: { "us-east-1": {} },
    };

    expect(() => validateConfig(invalidConfig)).toThrow("Invalid input type for testId");
  });

  it("should throw an error for invalid testTaskConfigs type", () => {
    const invalidConfig = {
      testId: "test-123",
      testName: "Test Name",
      testDescription: "Test Description",
      testTaskConfigs: "not-an-object", // Should be an object
      testScenario: { execution: [] },
      showLive: true,
      testType: "simple",
      fileType: "none",
      regionalTaskDetails: { "us-east-1": {} },
    };

    expect(() => validateConfig(invalidConfig)).toThrow("Invalid input type for testTaskConfigs");
  });

  it("should throw an error for invalid showLive type", () => {
    const invalidConfig = {
      testId: "test-123",
      testName: "Test Name",
      testDescription: "Test Description",
      testTaskConfigs: [{ region: "us-east-1" }],
      testScenario: { execution: [] },
      showLive: "yes", // Should be a boolean
      testType: "simple",
      fileType: "none",
      regionalTaskDetails: { "us-east-1": {} },
    };

    expect(() => validateConfig(invalidConfig)).toThrow("Invalid input type for showLive");
  });

  it("should validate a config with only required fields", () => {
    const minimalConfig = {
      testTaskConfigs: [{ region: "us-east-1" }],
      testScenario: { execution: [] },
    };

    // This should not throw an error even with missing optional fields
    expect(() => validateConfig(minimalConfig)).not.toThrow();
  });

  it("should ignore fields not defined in testCreateKeyDataTypes", () => {
    const configWithExtraFields = {
      testId: "test-123",
      testName: "Test Name",
      testTaskConfigs: [{ region: "us-east-1" }],
      testScenario: { execution: [] },
      extraField1: "should be ignored",
      extraField2: 123,
    };

    // This should not throw an error for extra fields
    expect(() => validateConfig(configWithExtraFields)).not.toThrow();
  });
});

describe("handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("/regions endpoint", () => {
    it("should handle GET /regions successfully", async () => {
      const event = {
        resource: "/regions",
        httpMethod: "GET",
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("regions");
      expect(body).toHaveProperty("url");
      expect(scenarios.getAllRegionConfigs).toHaveBeenCalled();
      expect(scenarios.getCFUrl).toHaveBeenCalled();
    });

    it("should handle /regions with unsupported method", async () => {
      const event = {
        resource: "/regions",
        httpMethod: "POST",
        body: JSON.stringify({
          testId: "test-123",
          testName: "Test Name",
          testDescription: "Test Description",
        }),
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
      expect(response.body).toContain("Method: POST not supported");
    });
  });

  describe("/scenarios endpoint", () => {
    it("should handle GET /scenarios successfully", async () => {
      const event = {
        resource: "/scenarios",
        httpMethod: "GET",
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.listTests).toHaveBeenCalledWith(null);
    });

    it("should handle GET /scenarios with tag filtering", async () => {
      const event = {
        resource: "/scenarios",
        httpMethod: "GET",
        queryStringParameters: { tags: "tag1, tag2, tag3" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.listTests).toHaveBeenCalledWith(["tag1", "tag2", "tag3"]);
    });

    it("should handle GET /scenarios with listRegions operation", async () => {
      const event = {
        resource: "/scenarios",
        httpMethod: "GET",
        queryStringParameters: { op: "listRegions" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("regions");
      expect(scenarios.getAllRegionConfigs).toHaveBeenCalled();
      expect(scenarios.getCFUrl).toHaveBeenCalled();
    });

    it("should handle POST /scenarios for creating test", async () => {
      const testConfig = {
        testName: "Test Name",
        testDescription: "Test Description",
        testType: "simple",
        testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
        testScenario: { execution: [{ "hold-for": "1m" }] },
        regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } }
      };

      const event = {
        resource: "/scenarios",
        httpMethod: "POST",
        body: JSON.stringify(testConfig),
        headers: { "User-Agent": "test-agent" },
      };

      const context = { functionName: "test-function" };

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.createTest).toHaveBeenCalledWith(testConfig, "test-function");
    });

    it("should handle EventBridge invocation", async () => {
      const testConfig = {
        testName: "EventBridge Test",
        testDescription: "Test Description",
        testType: "simple",
        testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
        testScenario: { execution: [{ "hold-for": "1m" }] },
        regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } }
      };

      const event = {
        resource: "/scenarios",
        httpMethod: "POST", // EventBridge invocations still need httpMethod in tests
        body: JSON.stringify(testConfig),
        // No headers for EventBridge simulation
      };

      const context = { functionName: "test-function" };

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.createTest).toHaveBeenCalled();
    });
  });

  describe("/scenarios/{testId} endpoint", () => {
    it("should handle GET /scenarios/{testId}", async () => {
      const event = {
        resource: "/scenarios/{testId}",
        httpMethod: "GET",
        pathParameters: { testId: "test-123" },
        queryStringParameters: { history: "true" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = { functionName: "test-function" };

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.getTest).toHaveBeenCalledWith("test-123", { history: "true" });
    });

    it("should handle POST /scenarios/{testId} (cancel test)", async () => {
      const event = {
        resource: "/scenarios/{testId}",
        httpMethod: "POST",
        pathParameters: { testId: "test-123" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = { functionName: "test-function" };

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.cancelTest).toHaveBeenCalledWith("test-123");
    });

    it("should handle DELETE /scenarios/{testId}", async () => {
      const event = {
        resource: "/scenarios/{testId}",
        httpMethod: "DELETE",
        pathParameters: { testId: "test-123" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = { functionName: "test-function" };

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.deleteTest).toHaveBeenCalledWith("test-123", "test-function");
    });

    it("should handle unsupported method for /scenarios/{testId}", async () => {
      const event = {
        resource: "/scenarios/{testId}",
        httpMethod: "PUT",
        pathParameters: { testId: "test-123" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
    });
  });

  describe("/scenarios/{testId}/testruns endpoint", () => {
    it("should handle GET /scenarios/{testId}/testruns", async () => {
      const event = {
        resource: "/scenarios/{testId}/testruns",
        httpMethod: "GET",
        pathParameters: { testId: "test-123" },
        queryStringParameters: { limit: "10" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.getTestRuns).toHaveBeenCalledWith("test-123", { limit: "10" });
    });

    it("should handle DELETE /scenarios/{testId}/testruns", async () => {
      const deleteBody = ["run-1", "run-2"];
      const event = {
        resource: "/scenarios/{testId}/testruns",
        httpMethod: "DELETE",
        pathParameters: { testId: "test-123" },
        body: JSON.stringify(deleteBody),
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.deleteTestRuns).toHaveBeenCalledWith("test-123", deleteBody);
    });

    it("should handle /scenarios/{testId}/testruns with unsupported method", async () => {
      const event = {
        resource: "/scenarios/{testId}/testruns",
        httpMethod: "POST",
        pathParameters: {
          testId: "123",
        },
        body: JSON.stringify({
          testId: "123",
          testName: "Test Name",
          testDescription: "Test Description",
        }),
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
      expect(response.body).toContain("Method: POST not supported");
    });
  });

  describe("/scenarios/{testId}/testruns/{testRunId} endpoint", () => {
    it("should handle GET /scenarios/{testId}/testruns/{testRunId}", async () => {
      const event = {
        resource: "/scenarios/{testId}/testruns/{testRunId}",
        httpMethod: "GET",
        pathParameters: { testId: "test-123", testRunId: "run-123" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.getTestRun).toHaveBeenCalledWith("test-123", "run-123");
    });

    it("should handle /scenarios/{testId}/testruns/{testRunId} with unsupported method", async () => {
      const event = {
        resource: "/scenarios/{testId}/testruns/{testRunId}",
        httpMethod: "POST",
        pathParameters: {
          testId: "test-id-123",
          testRunId: "test-run-id-456",
        },
      };
      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
    });
  });

  describe("/scenarios/{testId}/baseline endpoint", () => {
    it("should handle GET /scenarios/{testId}/baseline with data", async () => {
      const event = {
        resource: "/scenarios/{testId}/baseline",
        httpMethod: "GET",
        pathParameters: { testId: "test-123" },
        queryStringParameters: { data: "true" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.getBaseline).toHaveBeenCalledWith("test-123", true);
    });

    it("should handle GET /scenarios/{testId}/baseline without data", async () => {
      const event = {
        resource: "/scenarios/{testId}/baseline",
        httpMethod: "GET",
        pathParameters: { testId: "test-123" },
        queryStringParameters: { data: "false" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.getBaseline).toHaveBeenCalledWith("test-123", false);
    });

    it("should handle PUT /scenarios/{testId}/baseline", async () => {
      const event = {
        resource: "/scenarios/{testId}/baseline",
        httpMethod: "PUT",
        pathParameters: { testId: "test-123" },
        body: JSON.stringify({ testRunId: "run-123" }),
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.setBaseline).toHaveBeenCalledWith("test-123", "run-123");
    });

    it("should handle DELETE /scenarios/{testId}/baseline", async () => {
      const event = {
        resource: "/scenarios/{testId}/baseline",
        httpMethod: "DELETE",
        pathParameters: { testId: "test-123" },
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.clearBaseline).toHaveBeenCalledWith("test-123");
    });

    it("should handle unsupported method for /scenarios/{testId}/baseline", async () => {
      const event = {
        resource: "/scenarios/{testId}/baseline",
        httpMethod: "POST",
        pathParameters: { testId: "test-123" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
    });
  });

  describe("/tasks endpoint", () => {
    it("should handle GET /tasks", async () => {
      const event = {
        resource: "/tasks",
        httpMethod: "GET",
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.listTasks).toHaveBeenCalled();
    });

    it("should handle unsupported method for /tasks", async () => {
      const event = {
        resource: "/tasks",
        httpMethod: "POST",
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
    });
  });

  describe("/vCPUDetails endpoint", () => {
    it("should handle GET /vCPUDetails", async () => {
      const event = {
        resource: "/vCPUDetails",
        httpMethod: "GET",
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.getAccountFargatevCPUDetails).toHaveBeenCalled();
    });

    it("should handle unsupported method for /vCPUDetails", async () => {
      const event = {
        resource: "/vCPUDetails",
        httpMethod: "POST",
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
    });
  });

  describe("/stack-info endpoint", () => {
    it("should handle GET /stack-info", async () => {
      const event = {
        resource: "/stack-info",
        httpMethod: "GET",
        headers: { "User-Agent": "test-agent" },
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(scenarios.getStackInfo).toHaveBeenCalled();
    });

    it("should handle unsupported method for /stack-info", async () => {
      const event = {
        resource: "/stack-info",
        httpMethod: "POST",
      };

      const context = {};

      const response = await apiServices.handler(event, context);

      expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
    });
  });

  describe("Metrics and error handling", () => {
    it("should handle correlation ID in headers", async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const event = {
        resource: "/regions",
        httpMethod: "GET",
        headers: { 
          "User-Agent": "test-agent",
          "X-Correlation-Id": "correlation-123"
        },
      };

      const context = { awsRequestId: "request-123" };

      await apiServices.handler(event, context);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Request ID: request-123, Correlation ID: correlation-123")
      );
      
      consoleSpy.mockRestore();
    });

    it("should handle correlation ID in lowercase headers", async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const event = {
        resource: "/regions",
        httpMethod: "GET",
        headers: { 
          "user-agent": "test-agent",
          "x-correlation-id": "correlation-456"
        },
      };

      const context = { awsRequestId: "request-456" };

      await apiServices.handler(event, context);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Request ID: request-456, Correlation ID: correlation-456")
      );
      
      consoleSpy.mockRestore();
    });

  });

  it("should handle error when Zod validation fails", async () => {
    const testConfig = {
      testId: 123, // Invalid type - should be string
      // Missing required fields: testName, testDescription, regionalTaskDetails
      testTaskConfigs: [{ region: "us-east-1" }], // Missing taskCount, concurrency
      testScenario: { execution: [] },
    };

    const event = {
      resource: "/scenarios",
      httpMethod: "POST",
      body: JSON.stringify(testConfig),
      headers: {},
      queryStringParameters: null,
    };

    const context = {
      functionName: "testFunction",
    };

    const response = await apiServices.handler(event, context);

    expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
    // Zod provides comprehensive validation errors
    expect(response.body).toContain("testId: Expected string, received number");
  });

  describe("Validation Integration Tests", () => {
    describe("Path Parameter Validation", () => {
      it("should reject invalid testId in path parameters", async () => {
        const event = {
          resource: "/scenarios/{testId}",
          httpMethod: "GET",
          pathParameters: {
            testId: "test_invalid_format", // Invalid format - underscore not allowed
          },
          queryStringParameters: null,
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("testId must contain only alphanumeric characters and hyphens");
      });

      it("should reject invalid testRunId in path parameters", async () => {
        const event = {
          resource: "/scenarios/{testId}/testruns/{testRunId}",
          httpMethod: "GET",
          pathParameters: {
            testId: "valid-test-id",
            testRunId: "run_invalid_format", // Invalid format
          },
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("testRunId must contain only alphanumeric characters and hyphens");
      });

      // Note: Positive path parameter validation is covered by the unit tests
    });

    describe("Query Parameter Validation", () => {
      it("should reject invalid scenarios query parameters", async () => {
        const event = {
          resource: "/scenarios",
          httpMethod: "GET",
          queryStringParameters: {
            op: "invalidOperation", // Invalid enum value
          },
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("Invalid enum value");
      });

      it("should reject invalid test runs query parameters", async () => {
        const event = {
          resource: "/scenarios/{testId}/testruns",
          httpMethod: "GET",
          pathParameters: {
            testId: "test-123",
          },
          queryStringParameters: {
            limit: "999", // Exceeds maximum limit of 100
          },
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("Limit must be between 1 and 100");
      });

      it("should reject invalid scenario query parameters", async () => {
        const event = {
          resource: "/scenarios/{testId}",
          httpMethod: "GET",
          pathParameters: {
            testId: "test-123",
          },
          queryStringParameters: {
            history: "invalid", // Must be "true" or "false"
          },
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("Invalid enum value");
      });

      // Note: Positive query parameter validation is covered by the unit tests
    });

    describe("Request Body Validation", () => {
      it("should reject invalid create test request body", async () => {
        const invalidTestConfig = {
          testName: "ab", // Too short
          testDescription: "", // Too short
          testType: "invalid", // Invalid enum
          testTaskConfigs: [], // Empty array
          testScenario: {}, // Missing execution
          regionalTaskDetails: {}, // Empty object
        };

        const event = {
          resource: "/scenarios",
          httpMethod: "POST",
          body: JSON.stringify(invalidTestConfig),
          headers: {},
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("testName must be at least 3 characters");
      });

      it("should reject invalid region format in test config", async () => {
        const testConfig = {
          testName: "Valid Test Name",
          testDescription: "Valid test description",
          testType: "simple",
          testTaskConfigs: [{
            region: "invalid-region-format", // Invalid region
            taskCount: 1,
            concurrency: 1
          }],
          testScenario: {
            execution: [{ "hold-for": "1m" }]
          },
          regionalTaskDetails: {
            "us-east-1": { dltAvailableTasks: 10 }
          }
        };

        const event = {
          resource: "/scenarios",
          httpMethod: "POST",
          body: JSON.stringify(testConfig),
          headers: {},
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("Invalid region format");
      });

      it("should reject invalid set baseline request body", async () => {
        const event = {
          resource: "/scenarios/{testId}/baseline",
          httpMethod: "PUT",
          pathParameters: {
            testId: "test-123",
          },
          body: JSON.stringify({
            testRunId: "invalid_format", // Invalid format
          }),
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("testRunId must contain only alphanumeric characters and hyphens");
      });

      it("should reject invalid delete test runs request body", async () => {
        const event = {
          resource: "/scenarios/{testId}/testruns",
          httpMethod: "DELETE",
          pathParameters: {
            testId: "test-123",
          },
          body: JSON.stringify([]), // Empty array not allowed
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("At least one testRunId is required");
      });

      // Note: Positive request body validation is covered by the unit tests
    });

    describe("Edge Cases and Error Handling", () => {
      it("should handle missing pathParameters gracefully", async () => {
        const event = {
          resource: "/scenarios/{testId}",
          httpMethod: "GET",
          // pathParameters missing
          queryStringParameters: null,
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("Path parameters are required for this resource");
      });

      it("should handle malformed JSON in request body", async () => {
        const event = {
          resource: "/scenarios",
          httpMethod: "POST",
          body: "{ invalid json", // Malformed JSON
          headers: {},
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("Invalid JSON");
      });

      // Note: Other positive test cases are covered by the unit tests

      it("should provide detailed validation errors for complex objects", async () => {
        const complexInvalidConfig = {
          testName: "Valid Name",
          testDescription: "Valid description",
          testType: "simple",
          testTaskConfigs: [
            {
              region: "us-east-1",
              taskCount: 1,
              concurrency: 1
            },
            {
              region: "invalid-region", // Error in nested object
              taskCount: 0, // Invalid value
              concurrency: -1 // Invalid value
            }
          ],
          testScenario: {
            execution: [] // Invalid - empty array
          },
          regionalTaskDetails: {
            "us-east-1": { dltAvailableTasks: 10 }
          },
          tags: ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"] // Too many tags
        };

        const event = {
          resource: "/scenarios",
          httpMethod: "POST",
          body: JSON.stringify(complexInvalidConfig),
          headers: {},
        };

        const response = await apiServices.handler(event, {});

        expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
        expect(response.body).toContain("testTaskConfigs[1]");
        expect(response.body).toContain("Invalid region format");
        expect(response.body).toContain("Number must be greater than 0");
        expect(response.body).toContain("Maximum 5 tags allowed");
      });
    });
  });

  it("should handle unsupported resource", async () => {
    const event = {
      resource: "/unsupported",
      httpMethod: "GET",
      body: JSON.stringify({
        testId: "unsupported-123",
        testName: "Unsupported Test",
        testDescription: "Test Description for Unsupported Resource",
      }),
    };

    const context = {};

    const response = await apiServices.handler(event, context);

    expect(response.statusCode).toBe(scenarios.StatusCodes.NOT_ALLOWED);
    expect(response.body).toContain("not supported for this resource");
  });
});
