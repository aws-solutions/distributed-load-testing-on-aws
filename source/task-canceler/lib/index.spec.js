// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockAWS = require("aws-sdk");
const mockDynamoDb = {
  update: jest.fn(),
};
const mockEcs = {
  listTasks: jest.fn(),
  stopTask: jest.fn(),
};

mockAWS.ECS = jest.fn(() => ({
  listTasks: mockEcs.listTasks,
  stopTask: mockEcs.stopTask,
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
  update: mockDynamoDb.update,
}));

process.env = {
  SCENARIOS_TABLE: "arn:of:scenariosTable",
  VERSION: "2.0.1",
  SOLUTION_ID: "sO0062",
};

const lambda = require("../index.js");

let event = {
  testId: "mockTestId",
  testTaskConfig: {
    region: "testRegion",
    taskCluster: "testTaskCluster",
  },
};

let listTasksResponse = (numTasks) => {
  let taskList = [];
  for (let i = 0; i < numTasks; i++) {
    taskList.push(`arn:of:task${i}`);
  }
  return { taskArns: taskList };
};

describe("#TASK RUNNER:: ", () => {
  beforeEach(() => {
    mockEcs.stopTask.mockReset();
    mockEcs.listTasks.mockReset();
    mockDynamoDb.update.mockReset();
  });

  it("Should return test canceled when there is less than 100 tasks to delete", async () => {
    let listResponse = listTasksResponse(1);
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve(listResponse);
      },
    }));

    mockEcs.stopTask.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: [] });
      },
    }));

    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));

    const response = await lambda.handler(event);
    expect(response).toEqual("test cancelled");
  });
  it('Should return "test stopped due to error" when error is included in event', async () => {
    let listResponse = listTasksResponse(1);
    event.error = "error";
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve(listResponse);
      },
    }));

    mockEcs.stopTask.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: [] });
      },
    }));

    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));

    const response = await lambda.handler(event);
    expect(response).toEqual("test stopped due to error");
    delete event.error;
  });
  it("Should return test canceled when and call listTasks multiple times when nextToken", async () => {
    let listResponse = listTasksResponse(1);
    const mockEcs = {
      listTasks: jest.fn(),
      stopTask: jest.fn(),
    };
    mockAWS.ECS = jest.fn(() => ({
      listTasks: mockEcs.listTasks,
      stopTask: mockEcs.stopTask,
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: listResponse.taskArns, nextToken: "a1" });
      },
    }));
    delete listResponse.nextToken;
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve(listResponse);
      },
    }));

    mockEcs.stopTask.mockImplementation(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: [] });
      },
    }));

    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));

    const response = await lambda.handler(event);

    expect(mockEcs.listTasks).toHaveBeenCalledTimes(3);
    expect(response).toEqual("test cancelled");
  });
  it('Should return "test canceled" and wait between stopTask when more than 100 tasks', async () => {
    let listResponse = listTasksResponse(50);
    const mockEcs = {
      listTasks: jest.fn(),
      stopTask: jest.fn(),
    };
    mockAWS.ECS = jest.fn(() => ({
      listTasks: mockEcs.listTasks,
      stopTask: mockEcs.stopTask,
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: listResponse.taskArns, nextToken: "a1" });
      },
    }));
    const listResponseSecondCall = listTasksResponse(51);
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve(listResponseSecondCall);
      },
    }));

    mockEcs.stopTask.mockImplementation(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: [] });
      },
    }));

    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));

    const response = await lambda.handler(event);

    expect(mockEcs.stopTask).toHaveBeenCalledTimes(101);
    expect(response).toEqual("test cancelled");
  });
  //negative tests
  it("Should throw error when listTasks fails", async () => {
    const mockEcs = {
      listTasks: jest.fn(),
      stopTask: jest.fn(),
    };
    mockAWS.ECS = jest.fn(() => ({
      listTasks: mockEcs.listTasks,
      stopTask: mockEcs.stopTask,
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.reject("List Tasks Error");
      },
    }));

    mockEcs.stopTask.mockImplementation(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: [] });
      },
    }));

    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    try {
      await lambda.handler(event);
    } catch (err) {
      expect(err).toEqual("List Tasks Error");
    }
  });
});
