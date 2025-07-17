// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockDynamoDb = {
  update: jest.fn(),
  get: jest.fn(),
};

const mockEcs = {
  runTask: jest.fn(),
  listTasks: jest.fn(),
  describeTasks: jest.fn(),
};

const mockCloudWatch = {
  putDashboard: jest.fn(),
  getDashboard: jest.fn(),
};

const mockCloudWatchLogs = {
  putMetricFilter: jest.fn(),
};

const mockS3 = {
  putObject: jest.fn(),
};

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn(() => ({
      update: mockDynamoDb.update,
      get: mockDynamoDb.get,
    })),
  },
}));

jest.mock("@aws-sdk/client-ecs", () => ({
  ECS: jest.fn(() => ({
    runTask: mockEcs.runTask,
    listTasks: mockEcs.listTasks,
    describeTasks: mockEcs.describeTasks,
  })),
}));

jest.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatch: jest.fn(() => ({
    putDashboard: mockCloudWatch.putDashboard,
    getDashboard: mockCloudWatch.getDashboard,
  })),
}));

jest.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  CloudWatchLogs: jest.fn(() => ({
    putMetricFilter: mockCloudWatchLogs.putMetricFilter,
  })),
}));

jest.mock("@aws-sdk/client-s3", () => ({
  S3: jest.fn(() => ({
    putObject: mockS3.putObject,
  })),
}));

// Mock Date
const now = new Date();
global.Date = jest.fn(() => now);
global.Date.getTime = now.getTime();

process.env = {
  SCENARIOS_BUCKET: "mock-bucket",
  SOLUTION_ID: "SO0062",
  VERSION: "2.0.1",
  MAIN_STACK_REGION: "us-west-2",
};

const lambda = require("../index.js");
let event = {
  testTaskConfig: {
    region: "us-west-2",
    concurrency: 3,
    taskCount: 5,
    ecsCloudWatchLogGroup: "testEcsCloudWatchLogGroup",
    taskCluster: "testTaskCluster",
    taskDefinition: "arn:aws:ecs:us-west-2:123456789012:task-definition/testTaskDefinition:1",
    subnetB: "subnet-1111aaaa",
    taskImage: "test-load-tester",
    subnetA: "subnet-2222bbbb",
    taskSecurityGroup: "sg-abcd1234",
  },
  testId: "testId",
  testType: "simple",
  fileType: "none",
  showLive: true,
  isRunning: false,
  prefix: now.toISOString().replace("Z", ""),
};
const origEvent = event;

const calcTimeout = (taskCount) => Math.floor(Math.ceil(taskCount / 10) * 1.5 + 600).toString();

let mockParam = {
  taskDefinition: event.testTaskConfig.taskDefinition,
  cluster: event.testTaskConfig.taskCluster,
  count: 0,
  group: event.testId,
  launchType: "FARGATE",
  networkConfiguration: {
    awsvpcConfiguration: {
      assignPublicIp: "ENABLED",
      securityGroups: [event.testTaskConfig.taskSecurityGroup],
      subnets: [event.testTaskConfig.subnetA, event.testTaskConfig.subnetB],
    },
  },
  overrides: {
    containerOverrides: [
      {
        name: event.testTaskConfig.taskImage,
        environment: [
          { name: "MAIN_STACK_REGION", value: process.env.MAIN_STACK_REGION },
          { name: "S3_BUCKET", value: process.env.SCENARIOS_BUCKET },
          { name: "TEST_ID", value: event.testId },
          { name: "TEST_TYPE", value: "simple" },
          { name: "FILE_TYPE", value: "none" },
          { name: "LIVE_DATA_ENABLED", value: "live=true" },
          { name: "TIMEOUT", value: calcTimeout(event.testTaskConfig.taskCount) },
          { name: "PREFIX", value: event.prefix },
          { name: "SCRIPT", value: "ecslistener.py" },
        ],
      },
    ],
  },
  propagateTags: "TASK_DEFINITION",
  startedBy: "testId",
  tags: [
    { key: "TestId", value: "testId" },
    { key: "SolutionId", value: process.env.SOLUTION_ID },
  ],
};
const origMockParam = mockParam;
const modifyContainerOverrides = (key, value) => {
  mockParam.overrides.containerOverrides[0].environment.forEach((envVar, index) => {
    key === envVar.name && (mockParam.overrides.containerOverrides[0].environment[index].value = value);
  });
};
let describeTasksReturn = (numTasks) => {
  const taskList = [];
  const ipNetwork = "1.1";
  const ipHosts = [];
  for (let i = 0; i < numTasks; i++) {
    taskList.push({ containers: [{ networkInterfaces: [{ privateIpv4Address: `1.1.1.${i}` }] }] });
    ipHosts.push(`1.${i}`);
  }

  modifyContainerOverrides("IPNETWORK", ipNetwork.toString());
  return taskList;
};
let getTaskIds = (numTasks) => {
  const tasks = [];
  for (let i = 0; i < numTasks; i++) {
    let num = i > 9 ? i - 10 : i;
    tasks.push(`a/${num}`);
  }
  return tasks;
};

let runTaskReturn = (numTasks) => {
  let tasks = [];
  for (let i = 0; i < numTasks; i++) {
    tasks.push({ taskArn: `a/${i}` });
  }
  return tasks;
};

let mockGetRemainingTimeInMillis = () => 120000;
let mockContext = {
  getRemainingTimeInMillis: mockGetRemainingTimeInMillis,
};

describe("#TASK RUNNER:: ", () => {
  beforeEach(() => {
    mockEcs.runTask.mockReset();
    mockEcs.listTasks.mockReset();
    mockEcs.describeTasks.mockReset();
    mockDynamoDb.update.mockReset();
    mockCloudWatch.putDashboard.mockReset();
    mockCloudWatchLogs.putMetricFilter.mockReset();
    event = { ...origEvent };
    mockParam = { ...origMockParam };
  });

  it("should return scenario and prefix when running ECS worker tasks succeeds", async () => {
    mockCloudWatchLogs.putMetricFilter.mockResolvedValue({});
    mockCloudWatch.putDashboard.mockResolvedValue({});

    // Checking for worker tasks - so it's total tasks - 1
    mockEcs.runTask.mockResolvedValueOnce({
      tasks: runTaskReturn(4),
      failures: [],
    });

    mockDynamoDb.get.mockResolvedValueOnce({
      Item: { status: "running" },
    });

    mockEcs.listTasks.mockResolvedValueOnce({
      taskArns: [1, 2, 3, 4],
    });

    const response = await lambda.handler(event, mockContext);
    let expectedResponse = {
      fileType: "none",
      isRunning: true,
      prefix: event.prefix,
      showLive: true,
      testId: "testId",
      taskIds: ["a/0", "a/1", "a/2", "a/3"],
    };
    expect(mockEcs.runTask).toHaveBeenCalledTimes(1);
    expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 4 });
    expect(response).toEqual(expect.objectContaining(expectedResponse));
  });
  it('isRunning should be false if DDB returns "status !== running', async () => {
    mockCloudWatchLogs.putMetricFilter.mockResolvedValue({});
    mockCloudWatch.putDashboard.mockResolvedValue({});

    mockEcs.runTask.mockResolvedValueOnce({
      tasks: runTaskReturn(4),
      failures: [],
    });

    mockDynamoDb.get.mockResolvedValueOnce({
      Item: { status: "stopped" },
    });
    const response = await lambda.handler(event, mockContext);
    expect(response.isRunning).toEqual(false);
  });
  it("should return scenario and prefix when running more than 10 ECS workers succeeds", async () => {
    mockCloudWatchLogs.putMetricFilter.mockImplementation(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockCloudWatch.putDashboard.mockImplementation(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockEcs.runTask
      .mockResolvedValueOnce({
        tasks: runTaskReturn(10),
        failures: [],
      })
      .mockResolvedValueOnce({
        tasks: runTaskReturn(9),
        failures: [],
      });

    mockDynamoDb.get.mockResolvedValueOnce({
      Item: { status: "running" },
    });

    let taskList = runTaskReturn(10);
    taskList = taskList.concat(runTaskReturn(9));
    mockEcs.listTasks.mockResolvedValueOnce({
      taskArns: taskList,
    });

    event.testTaskConfig.taskCount = 20;
    modifyContainerOverrides("TIMEOUT", calcTimeout(event.testTaskConfig.taskCount));
    let tasks = getTaskIds(19);
    let expectedResponse = {
      isRunning: true,
      prefix: event.prefix,
      taskIds: tasks,
      testTaskConfig: {
        concurrency: 3,
        ecsCloudWatchLogGroup: "testEcsCloudWatchLogGroup",
        region: "us-west-2",
        subnetA: "subnet-2222bbbb",
        subnetB: "subnet-1111aaaa",
        taskCluster: "testTaskCluster",
        taskCount: 20,
        taskDefinition: "arn:aws:ecs:us-west-2:123456789012:task-definition/testTaskDefinition:1",
        taskImage: "test-load-tester",
        taskSecurityGroup: "sg-abcd1234",
      },
      fileType: "none",
      showLive: true,
      testId: "testId",
      testType: "simple",
    };

    const response = await lambda.handler(event, mockContext);
    expect(mockEcs.runTask).toHaveBeenCalledTimes(2);
    expect(mockEcs.runTask).toHaveBeenNthCalledWith(1, { ...mockParam, count: 10 });
    expect(mockEcs.runTask).toHaveBeenNthCalledWith(2, { ...mockParam, count: 9 });
    expect(response).toEqual(expect.objectContaining(expectedResponse));
  });
  it("should return when launching leader task is successful", async () => {
    mockParam.overrides.containerOverrides[0].environment[8].value = "ecscontroller.py";
    mockParam.overrides.containerOverrides[0].environment.push({ name: "IPNETWORK", value: "" });
    let taskIds = getTaskIds(5);
    event.taskIds = taskIds;
    let taskList = describeTasksReturn(4);

    mockEcs.describeTasks.mockResolvedValueOnce({
      tasks: taskList,
    });

    mockEcs.runTask.mockResolvedValue({
      tasks: runTaskReturn(1),
      failures: [],
    });

    mockEcs.listTasks.mockResolvedValueOnce({});

    mockS3.putObject.mockResolvedValueOnce({});

    let expectedResponse = {
      fileType: "none",
      isRunning: true,
      prefix: event.prefix,
      testTaskConfig: {
        concurrency: event.testTaskConfig.concurrency,
        ecsCloudWatchLogGroup: "testEcsCloudWatchLogGroup",
        subnetA: "subnet-2222bbbb",
        subnetB: "subnet-1111aaaa",
        taskCluster: "testTaskCluster",
        taskCount: event.testTaskConfig.taskCount,
        taskDefinition: "arn:aws:ecs:us-west-2:123456789012:task-definition/testTaskDefinition:1",
        taskImage: "test-load-tester",
        taskSecurityGroup: "sg-abcd1234",
        region: "us-west-2",
      },
      showLive: true,
      testId: "testId",
      testType: "simple",
    };

    const response = await lambda.handler(event);
    expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
    expect(response).toEqual(expect.objectContaining(expectedResponse));
  });
  it("an error should be thrown when lead task fails to run", async () => {
    let taskIds = getTaskIds(5);
    event.taskIds = taskIds;
    let taskList = describeTasksReturn(4);

    mockEcs.describeTasks.mockResolvedValueOnce({
      tasks: taskList,
    });

    mockEcs.runTask.mockResolvedValue({
      tasks: [],
      failures: ["Task failure"],
    });

    mockEcs.listTasks.mockResolvedValueOnce({});
    mockDynamoDb.update.mockResolvedValueOnce({});
    mockS3.putObject.mockResolvedValueOnce({});

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
      expect(error).toEqual(["Task failure"]);
    }
    mockParam.overrides.containerOverrides[0].environment.pop();
    mockParam.overrides.containerOverrides[0].environment.pop();
  });
  it('should throw "ECS ERROR" when ECS.runTask fails', async () => {
    mockCloudWatchLogs.putMetricFilter.mockResolvedValue({});
    mockCloudWatch.putDashboard.mockResolvedValue({});
    mockEcs.runTask.mockRejectedValueOnce("ECS ERROR");
    mockDynamoDb.update.mockResolvedValueOnce({});

    try {
      event.testTaskConfig.taskCount = 1;
      modifyContainerOverrides("TIMEOUT", calcTimeout(event.testTaskConfig.taskCount));
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.testId,
        },
        UpdateExpression: "set #s = :s, #e = :e",
        ExpressionAttributeNames: {
          "#s": "status",
          "#e": "errorReason",
        },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": "Failed to run Fargate tasks.",
        },
      });
      expect(error).toEqual("ECS ERROR");
    }
  });
  it("should throw an error when DynamoDB.DocumentClient.update fails and not update the DynamoDB", async () => {
    mockCloudWatchLogs.putMetricFilter.mockResolvedValue({});
    mockCloudWatch.putDashboard.mockResolvedValue({});
    mockEcs.runTask.mockRejectedValueOnce("ECS ERROR");
    mockDynamoDb.update.mockRejectedValueOnce("DynamoDB.DocumentClient.update failed");
    mockS3.putObject.mockResolvedValueOnce({});

    try {
      event.taskCount = 1;
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.testId,
        },
        UpdateExpression: "set #s = :s, #e = :e",
        ExpressionAttributeNames: {
          "#s": "status",
          "#e": "errorReason",
        },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": "Failed to run Fargate tasks.",
        },
      });
      expect(error).toEqual("DynamoDB.DocumentClient.update failed");
    }
  });
});
