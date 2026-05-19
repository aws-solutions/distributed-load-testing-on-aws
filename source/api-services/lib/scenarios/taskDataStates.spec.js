// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Tests for ECS task data retrieval edge cases:
// - ECS service not found returns empty tasks array
// - desiredStatus field is present in task data response

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
process.env.MIN_COMPATIBLE_VERSION = "3.0.0";

const lambda = require("./index.js");

describe("Task Data States — ECS Edge Cases", () => {
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

  /**
   * Requirement 6.2: When the ECS service does not yet exist, listTasksPerRegion
   * returns zero counts for that region instead of throwing.
   */
  describe("ECS service not found returns zero counts", () => {
    it("should return zero counts when ECS describeServices throws ServiceNotFoundException", async () => {
      const testId = "test-svc-not-found";

      // getTestAndRegionConfigs: first call returns scenario, second returns regional config
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Item: {
            testId,
            name: "service-not-found-test",
            status: "provisioning",
            testScenario: '{"name":"example"}',
            testTaskConfigs: [
              { region: "us-east-1", taskCluster: "testCluster", concurrency: "5", taskCount: "5" },
            ],
          },
        })
      );
      // Regional config lookup
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Item: {
            testId: "region-us-east-1",
            region: "us-east-1",
            taskCluster: "testCluster",
            taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef:1",
            subnetA: "subnet-aaa",
            subnetB: "subnet-bbb",
            taskSecurityGroup: "sg-000",
            taskImage: "test-image",
            ecsCloudWatchLogGroup: "testLogGroup",
          },
        })
      );
      // getTotalCount
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 0 }));
      // getTestHistoryEntries
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [] }));

      // ECS describeServices throws ServiceNotFoundException
      const serviceNotFoundError = new Error("Service not found");
      serviceNotFoundError.name = "ServiceNotFoundException";
      mockEcs.mockImplementationOnce(() => Promise.reject(serviceNotFoundError));

      const response = await lambda.getTest(testId);

      expect(response.tasksPerRegion).toBeDefined();
      expect(response.tasksPerRegion).toHaveLength(1);
      expect(response.tasksPerRegion[0].region).toBe("us-east-1");
      expect(response.tasksPerRegion[0].running).toBe(0);
      expect(response.tasksPerRegion[0].pending).toBe(0);
      expect(response.tasksPerRegion[0].desired).toBe(0);
    });
  });

  /**
   * Requirement 6.3: The describeServices-based response includes running,
   * pending, and desired counts per region.
   */
  describe("task counts in task data response", () => {
    it("should include running, pending, and desired counts returned by getTest", async () => {
      const testId = "test-desired-status";

      // getTestAndRegionConfigs: scenario data
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Item: {
            testId,
            name: "desired-status-test",
            status: "running",
            testScenario: '{"name":"example"}',
            testTaskConfigs: [
              { region: "us-east-1", taskCluster: "testCluster", concurrency: "5", taskCount: "5" },
            ],
          },
        })
      );
      // Regional config lookup
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Item: {
            testId: "region-us-east-1",
            region: "us-east-1",
            taskCluster: "testCluster",
            taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef:1",
            subnetA: "subnet-aaa",
            subnetB: "subnet-bbb",
            taskSecurityGroup: "sg-000",
            taskImage: "test-image",
            ecsCloudWatchLogGroup: "testLogGroup",
          },
        })
      );
      // getTotalCount
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 }));
      // getTestHistoryEntries
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [] }));

      // ECS describeServices returns service with task counts
      mockEcs.mockImplementationOnce(() =>
        Promise.resolve({
          services: [
            {
              serviceName: `dlt-${testId}-us-east-1`,
              runningCount: 3,
              pendingCount: 2,
              desiredCount: 5,
            },
          ],
        })
      );

      const response = await lambda.getTest(testId);

      expect(response.tasksPerRegion).toBeDefined();
      expect(response.tasksPerRegion).toHaveLength(1);

      const regionData = response.tasksPerRegion[0];
      expect(regionData.region).toBe("us-east-1");
      expect(regionData.running).toBe(3);
      expect(regionData.pending).toBe(2);
      expect(regionData.desired).toBe(5);
    });
  });
});
