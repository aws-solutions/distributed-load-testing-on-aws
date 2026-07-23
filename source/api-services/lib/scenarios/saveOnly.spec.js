// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Coverage for the saveOnly path in createTest and the related deleteTest
// allowlist expansion that lets a test in "created" status be deleted.
//
// These tests pin three behaviors introduced alongside the saveOnly flag:
//   1. saveOnly=true on a new test creates it in status "created" and skips
//      Step Functions execution.
//   2. saveOnly=true on an existing test preserves its status and skips
//      Step Functions, but only when the existing status is in the safeToEdit
//      allowlist (complete, cancelled, failed, scheduled, created). Any other
//      status returns 409 CONFLICT with code TEST_RUNNING.
//   3. The deleteTest guard accepts "created" as a deletable status.
//
// The default code path (saveOnly omitted or false) is regression-tested to
// confirm Step Functions still runs and status is set to "queued".

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
const mockScheduler = jest.fn();

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
jest.doMock("@aws-sdk/client-scheduler", createMockFactory("@aws-sdk/client-scheduler", "Scheduler", mockScheduler));

const mockGetLatestVersionFromRss = jest.fn();
jest.doMock("@amzn/dlt-common", () => {
  const actual = jest.requireActual("@amzn/dlt-common");
  return {
    ...actual,
    getLatestVersionFromRss: mockGetLatestVersionFromRss,
  };
});

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
process.env.AWS_REGION = "us-east-1";

const lambda = require("./index.js");

const testId = "1234";

const baseConfig = {
  testId,
  testName: "mytest",
  testDescription: "test",
  testTaskConfigs: [
    { region: "us-east-1", concurrency: "5", taskCount: "5" },
    { region: "eu-west-1", concurrency: "5", taskCount: "5" },
  ],
  testScenario: {
    execution: [{ "ramp-up": "30s", "hold-for": "1m" }],
  },
  scheduleDate: "2018-02-28",
  scheduleTime: "12:30",
  regionalTaskDetails: {
    "us-east-1": { dltAvailableTasks: "2000" },
    "eu-west-1": { dltAvailableTasks: "1000" },
  },
};

const existingTestEntry = (status) => ({
  Item: {
    testId,
    name: "mytest",
    status,
    startTime: "2017-04-22 02:28:37",
    testScenario: '{"name":"example"}',
    testTaskConfigs: [{ region: "us-east-1", concurrency: "5", taskCount: "5" }],
  },
});

const allRegionalConfs = {
  Items: [
    {
      testId: "region-us-east-1",
      ecsCloudWatchLogGroup: "testClusterUS-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterUS",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
      subnetB: "subnet-123abc",
      region: "us-east-1",
      taskImage: "us-test-load-tester-image",
      subnetA: "subnet-456def",
      taskSecurityGroup: "sg-000000",
      version: "3.0.0",
    },
    {
      testId: "region-eu-west-1",
      ecsCloudWatchLogGroup: "testClusterEU-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterEU",
      taskDefinition: "arn:aws:ecs:eu-west-1:123456789012:task-definition/testTaskDef2:1",
      subnetB: "subnet-abc123",
      region: "eu-west-1",
      taskImage: "eu-test-load-tester-image",
      subnetA: "subnet-def456",
      taskSecurityGroup: "sg-111111",
      version: "3.0.0",
    },
  ],
};

const hubRegionalConf = {
  Item: {
    testId: "region-us-east-1",
    ecsCloudWatchLogGroup: "testCluster-DLTEcsDLTCloudWatchLogsGroup",
    taskCluster: "testCluster",
    taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
    subnetB: "subnet-123abc",
    region: "us-east-1",
    taskImage: "test-load-tester-image",
    subnetA: "subnet-456def",
    taskSecurityGroup: "sg-000000",
  },
};

const spokeRegionalConf = {
  Item: {
    testId: "region-eu-west-1",
    ecsCloudWatchLogGroup: "testClusterEU-DLTEcsDLTCloudWatchLogsGroup",
    taskCluster: "testClusterEU",
    taskDefinition: "arn:aws:ecs:eu-west-1:123456789012:task-definition/testTaskDef2:1",
    subnetB: "subnet-abc123",
    region: "eu-west-1",
    taskImage: "eu-test-load-tester-image",
    subnetA: "subnet-def456",
    taskSecurityGroup: "sg-111111",
  },
};

const updateData = { Attributes: { testStatus: "running" } };

const context = { functionName: "lambdaFunctionName" };

// Wires the standard happy-path mocks for createTest. The DynamoDB sequence is:
//   1. getTestEntry (Item)
//   2. getAllRegionConfigs (scan -> Items)
//   3. mergeTestAndInfraConfiguration -> hub region get
//   4. mergeTestAndInfraConfiguration -> spoke region get
//   5. updateTestDBEntry (Attributes)
const wireCreateTestMocks = ({ existing }) => {
  mockS3.mockImplementation(() => Promise.resolve());
  mockStepFunctions.mockImplementation(() => Promise.resolve());
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existing || {}));
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(allRegionalConfs));
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(hubRegionalConf));
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(spokeRegionalConf));
  mockDynamoDB.mockImplementationOnce((params) => {
    return Promise.resolve({
      Attributes: {
        testStatus: params && params.ExpressionAttributeValues && params.ExpressionAttributeValues[":s"],
        ...(params && params.ExpressionAttributeValues ? { startTime: params.ExpressionAttributeValues[":st"] } : {}),
      },
    });
  });
};

describe("saveOnly behavior", () => {
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
    mockGetLatestVersionFromRss.mockReset();
    mockGetLatestVersionFromRss.mockResolvedValue("9.9.9");
    jest.useFakeTimers("modern");
    jest.setSystemTime(new Date(Date.UTC(2017, 3, 22, 2, 28, 37)));
  });

  beforeAll(() => {
    process.env.TZ = "UTC";
  });

  // Test 1: new test with saveOnly=true creates with status "created" and no SFN execution.
  it('CREATETEST with saveOnly=true on a new test writes status "created" and does not start Step Functions', async () => {
    const config = { ...baseConfig, saveOnly: true };
    // No existing entry: getTestEntry returns an object with no Item.
    wireCreateTestMocks({ existing: { Item: undefined } });

    const response = await lambda.createTest(config, context.functionName);

    expect(mockStepFunctions).not.toHaveBeenCalled();
    expect(response.testStatus).toEqual("created");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ":s": "created" }),
      })
    );
    // startTime for a new saveOnly test is empty.
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ":st": "" }),
      })
    );
  });

  // Test 2: saveOnly=true on a complete test preserves the status and skips SFN.
  it("CREATETEST with saveOnly=true on a complete test preserves status and does not start Step Functions", async () => {
    const config = { ...baseConfig, saveOnly: true };
    wireCreateTestMocks({ existing: existingTestEntry("complete") });

    const response = await lambda.createTest(config, context.functionName);

    expect(mockStepFunctions).not.toHaveBeenCalled();
    expect(response.testStatus).toEqual("complete");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ":s": "complete" }),
      })
    );
    // startTime should be carried over from the existing entry.
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ":st": "2017-04-22 02:28:37" }),
      })
    );
  });

  // Test 3: saveOnly=true on a test in any non-safe status returns 409 CONFLICT.
  it.each(["running", "cancelling", "provisioning", "cleaning up", "parsing results"])(
    "CREATETEST with saveOnly=true on a %s test returns 409 CONFLICT and does not start Step Functions",
    async (status) => {
      expect.assertions(3);
      const config = { ...baseConfig, saveOnly: true };
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existingTestEntry(status)));

      try {
        await lambda.createTest(config, context.functionName);
      } catch (err) {
        expect(err.code).toEqual("TEST_RUNNING");
        expect(err.statusCode).toEqual(409);
      }
      expect(mockStepFunctions).not.toHaveBeenCalled();
    }
  );

  // Test 4: every member of safeToEdit allows saveOnly=true to succeed.
  it.each(["complete", "cancelled", "failed", "scheduled", "created"])(
    "CREATETEST with saveOnly=true on a %s test succeeds and does not start Step Functions",
    async (status) => {
      const config = { ...baseConfig, saveOnly: true };
      wireCreateTestMocks({ existing: existingTestEntry(status) });

      const response = await lambda.createTest(config, context.functionName);

      expect(mockStepFunctions).not.toHaveBeenCalled();
      expect(response.testStatus).toEqual(status);
    }
  );

  // Test 5: default path is preserved when saveOnly is undefined or false.
  it('CREATETEST without saveOnly starts Step Functions and writes status "queued"', async () => {
    const config = { ...baseConfig };
    wireCreateTestMocks({ existing: existingTestEntry("complete") });

    const response = await lambda.createTest(config, context.functionName);

    expect(mockStepFunctions).toHaveBeenCalled();
    expect(response.testStatus).toEqual("queued");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ":s": "queued" }),
      })
    );
  });

  it('CREATETEST with saveOnly=false starts Step Functions and writes status "queued"', async () => {
    const config = { ...baseConfig, saveOnly: false };
    wireCreateTestMocks({ existing: existingTestEntry("complete") });

    const response = await lambda.createTest(config, context.functionName);

    expect(mockStepFunctions).toHaveBeenCalled();
    expect(response.testStatus).toEqual("queued");
  });
});

describe("deleteTest allowlist", () => {
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
    mockGetLatestVersionFromRss.mockReset();
    mockGetLatestVersionFromRss.mockResolvedValue("9.9.9");
  });

  // Test 6: deleteTest accepts "created" status as a deletable state.
  it('DELETETEST succeeds when the test status is "created"', async () => {
    const createdEntry = existingTestEntry("created");
    // getTestEntry, getRegionConfigs (single regional config), deleteSchedules
    // (CloudWatchEvents listRules + Lambda invoke + delete), deleteDDBTestEntry,
    // getTestHistoryTestRunIds, batchWrite for history.
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(createdEntry));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(hubRegionalConf));
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [] }));

    const response = await lambda.deleteTest(testId, context.functionName);
    expect(response).toEqual("success");
  });
});
