// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockAWS = require('aws-sdk');
const mockEcs = {
  listTasks: jest.fn(),
  describeTasks: jest.fn(),
  stopTask: jest.fn()
};
const mockDynamoDb = {
  update: jest.fn()
};
const mockLambda = {
  invoke: jest.fn()
};
mockAWS.ECS = jest.fn(() => ({
	listTasks: mockEcs.listTasks,
  describeTasks: mockEcs.describeTasks,
  stopTask: mockEcs.stopTask
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
  update: mockDynamoDb.update
}));
mockAWS.Lambda = jest.fn(() => ({
  invoke: mockLambda.invoke
}));

process.env = {
  TASK_CLUSTER: 'mock-task-cluster',
  SCENARIOS_TABLE: 'mock-scenario-table',
  TASK_CANCELER_ARN: 'mock-task-canceler-arn',
  VERSION: '1.3.0',
  SOLUTION_ID: 'SO0062'
};

const lambda = require('../index.js');
const event = {
  scenario: { testId: 'xyz' }
};

describe('task-status-cheker', () => {
  beforeEach(() => {
    mockEcs.listTasks.mockReset();
    mockEcs.describeTasks.mockReset();
    mockDynamoDb.update.mockReset();
  });

  it('should return false for isRunning when there is no running task', async () => {
    mockEcs.listTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
    expect(response).toEqual({
      scenario: event.scenario,
      numTasksRunning: 1,
      isRunning: false,
      taskRunner: undefined
    });
  });

  it('should return false for isRunning when there is a running task but not a test task', async () => {
    mockEcs.listTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'other' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task' ] });
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false,
      numTasksRunning: 1,
      taskRunner: undefined
    });
  });

  it('should return false for isRunning when there are running tasks but not test tasks', async () => {
    mockEcs.listTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task1' ], nextToken: 'next' });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task2' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'other' }] });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'other' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenNthCalledWith(1, { cluster: process.env.TASK_CLUSTER });
    expect(mockEcs.listTasks).toHaveBeenNthCalledWith(2, { cluster: process.env.TASK_CLUSTER, nextToken: 'next' });
    expect(mockEcs.describeTasks).toHaveBeenNthCalledWith(1, { cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task1' ], });
    expect(mockEcs.describeTasks).toHaveBeenNthCalledWith(2, { cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task2' ], });
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false,
      numTasksRunning: 1,
      taskRunner: undefined
    });
  });

  it('should return true for isRunning when there is a running test task', async () => {
    mockEcs.listTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'xyz' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task' ] });
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: true,
      numTasksRunning: 1,
      taskRunner: undefined
    });
  });

  it('should return false for isRunning and prefix when there is no test running and prefix is provided', async () => {
    mockEcs.listTasks.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [] });
        }
      };
    });

    event.prefix = 'prefix';
    event.scenario.taskCount = 2;
    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false,
      prefix: 'prefix',
      numTasksRunning: 1,
      taskRunner: undefined
    });
  });

  it('should return true for isRunning and prefix when a test is still running and prefix is provided', async () => {
    mockEcs.listTasks.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task1', 'arn:of:ecs:task2' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'xyz' }, { group: 'xyz' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task1', 'arn:of:ecs:task2' ] });
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: true,
      prefix: 'prefix',
      numTasksRunning: 1,
      taskRunner: undefined
    });
  });

  it('should return true for isRunning, timeoutCount and prefix when a test is still running, any tasks completed, and prefix is provided', async () => {
    event.scenario.taskCount = 3;
    mockEcs.listTasks.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task1' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'xyz', taskArn: 'arn:of:ecs:task1' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task1' ] });
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: true,
      prefix: 'prefix',
      timeoutCount: 10,
      numTasksRunning: 1,
      taskRunner: undefined
    });
  });

  it('should return false for isRunning and prefix when timeout happens', async () => {
    mockEcs.listTasks.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task1' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'xyz', taskArn: 'arn:of:ecs:task1' }] });
        }
      };
    });
    mockLambda.invoke.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      };
    });

    event.timeoutCount = 1;
    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task1' ] });
    expect(mockLambda.invoke).toHaveBeenCalledWith({ 
      FunctionName: process.env.TASK_CANCELER_ARN, 
      InvocationType: 'Event', 
      Payload: JSON.stringify({testId: 'xyz'})
    });
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false,
      prefix: 'prefix',
      timeoutCount: 0,
      numTasksRunning: 1,
      taskRunner: undefined
    });
  });

  it('should throw an error when listTasks fails', async () => {
    mockEcs.listTasks.mockImplementation(() => {
      return {
        promise() {
          return Promise.reject('listTasks error');
        }
      };
    });
    mockDynamoDb.update.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      };
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check Fargate tasks.'
        }
      });
      expect(error).toEqual('listTasks error');
    }
  });

  it('should throw an error when describeTasks fails', async () => {
    mockEcs.listTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.reject('describeTasks error');
        }
      };
    });
    mockDynamoDb.update.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      };
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
      expect(mockEcs.describeTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task' ] });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check Fargate tasks.'
        }
      });
      expect(error).toEqual('describeTasks error');
    }
  });

  it('should throw an error when task canceler lambda fails', async () => {
    mockEcs.listTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task' ] });
        }
      };
    });
    mockEcs.describeTasks.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ tasks: [{ group: 'xyz', taskArn: 'arn:of:ecs:task' }] });
        }
      };
    });
    mockLambda.invoke.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.reject('stopTask error');
        }
      };
    });
    mockDynamoDb.update.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      };
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
      expect(mockEcs.describeTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER, tasks: [ 'arn:of:ecs:task' ] });
      expect(mockLambda.invoke).toHaveBeenCalledWith({ 
        FunctionName: process.env.TASK_CANCELER_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify({ testId: 'xyz' })
      });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check Fargate tasks.'
        }
      });
      expect(error).toEqual('stopTask error');
    }
  });

  it('should throw an error when DynamoDB.DocumentClient.update fails and not update the DynamoDB', async () => {
    mockEcs.listTasks.mockImplementation(() => {
      return {
        promise() {
          return Promise.reject('listTasks error');
        }
      };
    });
    mockDynamoDb.update.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.reject('DynamoDB.DocumentClient.update failed');
        }
      };
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: process.env.TASK_CLUSTER });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check Fargate tasks.'
        }
      });
      expect(error).toEqual('DynamoDB.DocumentClient.update failed');
    }
  });
})