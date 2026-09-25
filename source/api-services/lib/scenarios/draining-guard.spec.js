// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Coverage for the API-side ECS draining guard (assertNoDrainingService).
//
// DynamoDB status is a lagging proxy for "the per-region ECS service is free":
// after a run ends, DeleteService leaves the service DRAINING for a short time
// before it becomes INACTIVE, while the scenario status has already flipped to a
// terminal state. Starting a new run in that window would be accepted by the
// status guard, then fail in the Task Runner with "Unable to Start a service
// that is still Draining." The guard rejects that start with 409 SERVICE_DRAINING.
//
//   1. A region whose service is DRAINING → 409 SERVICE_DRAINING (transient).
//   2. A region whose service is ACTIVE → proceeds; a terminal-status scenario
//      with an ACTIVE service is a leaked service (cleanup never ran), out of
//      scope for this transient-drain guard.
//   3. A region whose service is INACTIVE or missing → proceeds (no throw).
//   4. A DescribeServices error is fail-open → proceeds (never blocks a start).
//   5. Multi-region: one draining region rejects and is named in the message.
//   6. A region with no infra config (no taskCluster) is skipped.

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
const regionalConfigs = [
  { region: "us-east-1", taskCluster: "clusterUS" },
  { region: "eu-west-1", taskCluster: "clusterEU" },
];

// describeServices response for a single service in the given status.
const svc = (status) => ({ services: [{ status }] });

describe("assertNoDrainingService (ECS draining guard)", () => {
  beforeEach(() => {
    mockEcs.mockReset();
  });

  it("rejects with 409 SERVICE_DRAINING when the service is DRAINING", async () => {
    expect.assertions(3);
    mockEcs.mockImplementation(() => Promise.resolve(svc("DRAINING")));

    try {
      await lambda.assertNoDrainingService(testId, [{ region: "us-east-1" }], regionalConfigs);
    } catch (err) {
      expect(err.code).toEqual("SERVICE_DRAINING");
      expect(err.statusCode).toEqual(409);
      expect(err.message).toContain("us-east-1: DRAINING");
    }
  });

  it("proceeds when the service is ACTIVE (leaked/stuck service is out of scope, not a transient drain)", async () => {
    // By the time this guard runs the scenario status is terminal; a transient
    // ACTIVE window only exists while the status is still active, where the
    // status guard already rejects. So terminal + ACTIVE means a leaked service
    // that will not self-clear — blocking it here would wedge the scenario with a
    // misleading "wait and retry". It is left to fail in the Task Runner instead.
    mockEcs.mockImplementation(() => Promise.resolve(svc("ACTIVE")));
    await expect(
      lambda.assertNoDrainingService(testId, [{ region: "us-east-1" }], regionalConfigs)
    ).resolves.toBeUndefined();
  });

  it("proceeds when the service is INACTIVE", async () => {
    mockEcs.mockImplementation(() => Promise.resolve(svc("INACTIVE")));
    await expect(lambda.assertNoDrainingService(testId, [{ region: "us-east-1" }], regionalConfigs)).resolves.toBeUndefined();
  });

  it("proceeds when the service is missing (already gone)", async () => {
    mockEcs.mockImplementation(() => Promise.resolve({ services: [] }));
    await expect(lambda.assertNoDrainingService(testId, [{ region: "us-east-1" }], regionalConfigs)).resolves.toBeUndefined();
  });

  it("fails open — proceeds when DescribeServices errors", async () => {
    mockEcs.mockImplementation(() => Promise.reject(new Error("ThrottlingException")));
    await expect(lambda.assertNoDrainingService(testId, [{ region: "us-east-1" }], regionalConfigs)).resolves.toBeUndefined();
  });

  it("skips a region that has no infra config (no taskCluster)", async () => {
    await expect(
      lambda.assertNoDrainingService(testId, [{ region: "ap-south-1" }], regionalConfigs)
    ).resolves.toBeUndefined();
    expect(mockEcs).not.toHaveBeenCalled();
  });

  it("multi-region: rejects and names the draining region when only one is still stopping", async () => {
    expect.assertions(2);
    // us-east-1 is gone (INACTIVE); eu-west-1 is still DRAINING.
    mockEcs.mockImplementation((params) => {
      const isEu = params.cluster === "clusterEU";
      return Promise.resolve(svc(isEu ? "DRAINING" : "INACTIVE"));
    });

    try {
      await lambda.assertNoDrainingService(
        testId,
        [{ region: "us-east-1" }, { region: "eu-west-1" }],
        regionalConfigs
      );
    } catch (err) {
      expect(err.code).toEqual("SERVICE_DRAINING");
      expect(err.message).toContain("eu-west-1: DRAINING");
    }
  });

  it("multi-region: proceeds when all services are gone", async () => {
    mockEcs.mockImplementation(() => Promise.resolve(svc("INACTIVE")));
    await expect(
      lambda.assertNoDrainingService(testId, [{ region: "us-east-1" }, { region: "eu-west-1" }], regionalConfigs)
    ).resolves.toBeUndefined();
  });
});
