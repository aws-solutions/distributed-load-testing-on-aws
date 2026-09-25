// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Coverage for the server-side single-run-per-scenario enforcement in
// createTest. DLT names the per-region ECS service run-agnostically
// (dlt-{testId}-{region}), so a second run started while one is in flight
// collides with and corrupts the live run. These tests pin the guard that
// rejects such a start with 409 CONFLICT (code TEST_RUNNING) before any S3
// write, Step Functions execution, or DynamoDB overwrite occurs.
//
//   1. A non-saveOnly start against any active state (queued, provisioning,
//      running, cancelling, cleaning up, parsing results) returns 409 and does
//      not touch S3 or Step Functions.
//   2. A non-saveOnly start against any safe state (complete, cancelled,
//      failed, scheduled, created) proceeds and starts Step Functions.
//   3. A start against a brand-new scenario (no existing record) proceeds.
//   4. The rejection message names the active run (status and startTime).

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
    testName: "mytest",
    testType: "simple",
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

const context = { functionName: "lambdaFunctionName" };

// Wires the standard happy-path mocks for createTest. DynamoDB sequence:
//   1. getTestEntry (get)
//   2. getAllRegionConfigs (scan)
//   3. claimRunSlot conditional write (update) — only when an existing record
//      is present (a new scenario has no in-flight run to claim against)
//   4. mergeTestAndInfraConfiguration hub region (get)
//   5. mergeTestAndInfraConfiguration spoke region (get)
//   6. updateTestDBEntry (update)
const wireCreateTestMocks = ({ existing }) => {
  const hasExisting = !!(existing && existing.Item);
  mockS3.mockImplementation(() => Promise.resolve());
  mockStepFunctions.mockImplementation(() => Promise.resolve());
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existing || {}));
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(allRegionalConfs));
  if (hasExisting) {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
  }
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

describe("single-run-per-scenario enforcement", () => {
  beforeEach(() => {
    mockS3.mockReset();
    mockStepFunctions.mockReset();
    mockDynamoDB.mockReset();
  });

  // A start against any in-flight state is rejected with 409 TEST_RUNNING and
  // never reaches S3 or Step Functions, so the live run cannot be corrupted.
  it.each(["queued", "provisioning", "running", "cancelling", "cleaning up", "parsing results"])(
    "CREATETEST (start) on a %s scenario returns 409 CONFLICT and starts no run",
    async (status) => {
      expect.assertions(4);
      // Only getTestEntry runs before the guard throws.
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existingTestEntry(status)));

      try {
        await lambda.createTest(baseConfig, context.functionName);
      } catch (err) {
        expect(err.code).toEqual("TEST_RUNNING");
        expect(err.statusCode).toEqual(409);
      }
      expect(mockStepFunctions).not.toHaveBeenCalled();
      expect(mockS3).not.toHaveBeenCalled();
    }
  );

  // Every safe (terminal/idle) state allows a fresh start.
  it.each(["complete", "cancelled", "failed", "scheduled", "created"])(
    "CREATETEST (start) on a %s scenario starts Step Functions",
    async (status) => {
      wireCreateTestMocks({ existing: existingTestEntry(status) });

      const response = await lambda.createTest(baseConfig, context.functionName);

      expect(mockStepFunctions).toHaveBeenCalled();
      expect(response.testStatus).toEqual("queued");
    }
  );

  it("CREATETEST (start) on a brand-new scenario with no existing record starts Step Functions", async () => {
    wireCreateTestMocks({ existing: { Item: undefined } });

    await lambda.createTest(baseConfig, context.functionName);

    expect(mockStepFunctions).toHaveBeenCalled();
  });

  it("names the active run (status and startTime) in the rejection message", async () => {
    expect.assertions(2);
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existingTestEntry("running")));

    try {
      await lambda.createTest(baseConfig, context.functionName);
    } catch (err) {
      expect(err.message).toContain("already has an active run");
      expect(err.message).toContain("status: running, started 2017-04-22 02:28:37");
    }
  });

  // The atomic claim closes the race the read check cannot: even when the read
  // saw a terminal status, a concurrent start can win the slot first. The
  // conditional write then fails and the loser is rejected with 409.
  it("rejects with 409 when the atomic claim loses the race (conditional check fails)", async () => {
    expect.assertions(3);
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existingTestEntry("complete"))); // getTestEntry (read check passes)
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(allRegionalConfs)); // scan
    // The repository detects the lost race via `instanceof ConditionalCheckFailedException`,
    // so throw the real error type here.
    const { ConditionalCheckFailedException } = require("@aws-sdk/client-dynamodb");
    const conflict = new ConditionalCheckFailedException({ $metadata: {}, message: "conditional request failed" });
    mockDynamoDB.mockImplementationOnce(() => Promise.reject(conflict)); // claimRunSlot (repository) loses the race
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existingTestEntry("running"))); // re-read to name the run

    try {
      await lambda.createTest(baseConfig, context.functionName);
    } catch (err) {
      expect(err.code).toEqual("TEST_RUNNING");
      expect(err.statusCode).toEqual(409);
    }
    expect(mockStepFunctions).not.toHaveBeenCalled();
  });

  // A start that claims the slot but then fails to launch must not leave the
  // scenario stuck in "queued": the prior status is restored.
  it("reverts the claimed status to the previous status when Step Functions fails to start", async () => {
    expect.assertions(2);
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(existingTestEntry("complete"))); // getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(allRegionalConfs)); // scan
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot succeeds
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(hubRegionalConf)); // hub
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(spokeRegionalConf)); // spoke
    const revert = jest.fn(() => Promise.resolve({}));
    mockDynamoDB.mockImplementationOnce(revert); // revertRunSlotClaim
    mockStepFunctions.mockImplementation(() => Promise.reject(new Error("SFN unavailable")));

    await expect(lambda.createTest(baseConfig, context.functionName)).rejects.toThrow();

    expect(revert).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ":prev": "complete" }),
      })
    );
  });
});
