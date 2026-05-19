// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDb = {
  scan: jest.fn(),
};

const mockSchedulerImpl = {
  deleteSchedule: jest.fn(),
};

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn(() => ({
      scan: mockDynamoDb.scan,
    })),
  },
}));

jest.mock("@aws-sdk/client-scheduler", () => ({
  Scheduler: jest.fn().mockImplementation(() => {
    return {deleteSchedule: mockSchedulerImpl.deleteSchedule};
  })
}));

process.env = {
  DDB_TABLE: "testDDBTable",
  MAIN_REGION: "us-east-2",
  SOLUTION_ID: "SO00XX",
  VERSION: "4.1.0",
};

const { cleanUpTestScenarioResources } = require("./index.js");

class ResourceNotFoundException extends Error {
  constructor(message) {
    super(message);
    this.name = "ResourceNotFoundException";
  }
}

describe("EventBridge schedules get deleted", () => {
  beforeEach(() => {
    mockDynamoDb.scan.mockResolvedValue({
      Items: [
        { testId: "norunyet", testName: "Created with schedule but no first run" },
        { testId: "ranonce", testName: "Created and ran at least once" },
        { testId: "runnow", testName: "Test without a schedule" },
      ],
      LastEvaluatedKey: null,
    });

    const notFound = new ResourceNotFoundException("Not Found");

    mockSchedulerImpl.deleteSchedule.mockResolvedValueOnce({});
    mockSchedulerImpl.deleteSchedule.mockRejectedValueOnce(notFound);
    mockSchedulerImpl.deleteSchedule.mockRejectedValueOnce(notFound);
    mockSchedulerImpl.deleteSchedule.mockResolvedValueOnce({});
    mockSchedulerImpl.deleteSchedule.mockRejectedValueOnce(notFound);
    mockSchedulerImpl.deleteSchedule.mockRejectedValueOnce(
      new Error("Simulate unexpected error")
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return "success" and delete two schedules', async () => {
    const response = await cleanUpTestScenarioResources();
    expect(response).toEqual("success");
    expect(mockDynamoDb.scan).toHaveBeenCalledTimes(1);
    expect(mockSchedulerImpl.deleteSchedule).toHaveBeenCalledTimes(6);

    expect(mockSchedulerImpl.deleteSchedule.mock.calls).toEqual(
      [
        [{Name: "norunyetCreate"}],
        [{Name: "norunyetScheduled"}],
        [{Name: "ranonceCreate"}],
        [{Name: "ranonceScheduled"}],
        [{Name: "runnowCreate"}],
        [{Name: "runnowScheduled"}],
      ]
    );
  });
});
