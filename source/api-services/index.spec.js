// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const apiServices = require("./index");
const scenarios = require("./lib/scenarios/");

// Mock the scenarios module
jest.mock("./lib/scenarios/", () => ({
  ErrorException: jest.fn((code, message, statusCode) => ({
    code,
    message,
    statusCode,
    toString: () => message,
  })),
  StatusCodes: {
    BAD_REQUEST: 400,
    NOT_ALLOWED: 405,
  },
  listTests: jest.fn(),
  getTest: jest.fn(),
  cancelTest: jest.fn(),
  createTest: jest.fn(),
  deleteTest: jest.fn(),
  scheduleTest: jest.fn(),
  listTasks: jest.fn(),
  getAccountFargatevCPUDetails: jest.fn(),
  getAllRegionConfigs: jest.fn(),
  getCFUrl: jest.fn(),
}));

jest.mock("solution-utils", () => ({
  sendMetric: jest.fn(),
}));

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

    expect(() => validateConfig(invalidConfig)).toThrow();
    expect(scenarios.ErrorException).toHaveBeenCalledWith(
      "BAD_INPUT",
      "Invalid input type for testId",
      scenarios.StatusCodes.BAD_REQUEST
    );
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

    expect(() => validateConfig(invalidConfig)).toThrow();
    expect(scenarios.ErrorException).toHaveBeenCalledWith(
      "BAD_INPUT",
      "Invalid input type for testTaskConfigs",
      scenarios.StatusCodes.BAD_REQUEST
    );
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

    expect(() => validateConfig(invalidConfig)).toThrow();
    expect(scenarios.ErrorException).toHaveBeenCalledWith(
      "BAD_INPUT",
      "Invalid input type for showLive",
      scenarios.StatusCodes.BAD_REQUEST
    );
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

  it("should handle /regions GET request successfully", async () => {
    const event = {
      resource: "/regions",
      httpMethod: "GET",
      body: JSON.stringify({
        testId: "test-123",
        testName: "Test Name",
        testDescription: "Test Description",
      }),
    };

    const context = {};

    scenarios.getAllRegionConfigs.mockResolvedValue(["us-east-1", "eu-west-1"]);
    scenarios.getCFUrl.mockResolvedValue("https://example.com/template.yaml");

    const response = await apiServices.handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      regions: ["us-east-1", "eu-west-1"],
      url: "https://example.com/template.yaml",
    });
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

  it("should handle /scenarios GET request successfully", async () => {
    const event = {
      resource: "/scenarios",
      httpMethod: "GET",
      body: JSON.stringify({
        testId: "test-123",
        testName: "Test Name",
        testDescription: "Test Description",
        testTaskConfigs: [{ region: "us-east-1" }],
      }),
    };

    const context = {};

    const mockTests = { Items: [{ testId: "123" }] };
    scenarios.listTests.mockResolvedValue(mockTests);

    const response = await apiServices.handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(mockTests);
  });

  it("should handle /scenarios POST request for creating test", async () => {
    const testConfig = {
      testName: "Test Name",
      testTaskConfigs: [{ region: "us-east-1" }],
      testScenario: { execution: [{ "hold-for": "1m", "ramp-up": "30s" }] },
      testType: "simple",
      fileType: "none",
    };

    const event = {
      resource: "/scenarios",
      httpMethod: "POST",
      body: JSON.stringify(testConfig),
      headers: {},
    };

    const context = {
      functionName: "testFunction",
    };

    const mockResponse = { testId: "123", status: "running" };
    scenarios.createTest.mockResolvedValue(mockResponse);

    const response = await apiServices.handler(event, context);

    expect(scenarios.createTest).toHaveBeenCalledWith(testConfig, "testFunction");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(mockResponse);
  });

  it("should handle /scenarios/{testId} GET request", async () => {
    const event = {
      resource: "/scenarios/{testId}",
      httpMethod: "GET",
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

    const mockTest = { testId: "123", name: "Test Name" };
    scenarios.getTest.mockResolvedValue(mockTest);

    const response = await apiServices.handler(event, context);

    expect(scenarios.getTest).toHaveBeenCalledWith("123");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(mockTest);
  });

  it("should handle /scenarios/{testId} POST request for canceling test", async () => {
    const event = {
      resource: "/scenarios/{testId}",
      httpMethod: "POST",
      pathParameters: {
        testId: "123",
      },
      body: JSON.stringify({
        testId: "123",
        testName: "Test to Cancel",
        testDescription: "Test Description for Cancellation",
      }),
    };

    const context = {};

    scenarios.cancelTest.mockResolvedValue("test cancelling");

    const response = await apiServices.handler(event, context);

    expect(scenarios.cancelTest).toHaveBeenCalledWith("123");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toBe("test cancelling");
  });

  it("should handle /scenarios/{testId} DELETE request", async () => {
    const event = {
      resource: "/scenarios/{testId}",
      httpMethod: "DELETE",
      pathParameters: {
        testId: "123",
      },
      body: JSON.stringify({
        testId: "123",
        testName: "Test to Delete",
        testDescription: "Test Description for Deletion",
      }),
    };

    const context = {
      functionName: "testFunction",
    };

    scenarios.deleteTest.mockResolvedValue("success");

    const response = await apiServices.handler(event, context);

    expect(scenarios.deleteTest).toHaveBeenCalledWith("123", "testFunction");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toBe("success");
  });

  it("should handle /tasks GET request", async () => {
    const event = {
      resource: "/tasks",
      httpMethod: "GET",
      body: JSON.stringify({
        testId: "task-test-123",
        testName: "Task Test",
        testDescription: "Test Description for Tasks",
      }),
    };

    const context = {};

    const mockTasks = [{ region: "us-east-1", tasks: [] }];
    scenarios.listTasks.mockResolvedValue(mockTasks);

    const response = await apiServices.handler(event, context);

    expect(scenarios.listTasks).toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(mockTasks);
  });

  it("should handle /vCPUDetails GET request", async () => {
    const event = {
      resource: "/vCPUDetails",
      httpMethod: "GET",
      body: JSON.stringify({
        testId: "vcpu-test-123",
        testName: "vCPU Test",
        testDescription: "Test Description for vCPU Details",
      }),
    };

    const context = {};

    const mockDetails = { "us-east-1": { vCPULimit: 4000 } };
    scenarios.getAccountFargatevCPUDetails.mockResolvedValue(mockDetails);

    const response = await apiServices.handler(event, context);

    expect(scenarios.getAccountFargatevCPUDetails).toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(mockDetails);
  });

  it("should handle error when validateConfig throws an exception", async () => {
    const testConfig = {
      testId: 123, // Invalid type
      testTaskConfigs: [{ region: "us-east-1" }],
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

    // Mock validateConfig to throw an error
    const originalValidateConfig = apiServices.validateConfig;
    const mockError = new Error("Invalid input type for testId");
    mockError.code = "BAD_INPUT";
    mockError.statusCode = scenarios.StatusCodes.BAD_REQUEST;
    mockError.toString = () => "Invalid input type for testId";

    // Replace validateConfig with a mock that throws
    apiServices.validateConfig = jest.fn().mockImplementation(() => {
      throw mockError;
    });

    const response = await apiServices.handler(event, context);

    // Restore original function
    apiServices.validateConfig = originalValidateConfig;

    expect(response.statusCode).toBe(scenarios.StatusCodes.BAD_REQUEST);
    expect(response.body).toContain("Invalid input type for testId");
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
