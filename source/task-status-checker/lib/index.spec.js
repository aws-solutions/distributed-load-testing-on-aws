// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockAWS = require('aws-sdk');
const mockEcs = jest.fn();
mockAWS.ECS = jest.fn(() => ({
	listTasks: mockEcs,
	describeTasks: mockEcs
}));

const event = {
  scenario: {
    testId: 'xyz'
  }
};

const lambda = require('../index.js');

describe('task-status-cheker', () => {
  beforeEach(() => {
    mockEcs.mockReset();
  });

  it('should return false for isRunning when there is no running task', async () => {
    mockEcs.mockImplementation(() => {
      return {
        promise() {
          // listTasks
          return Promise.resolve({ taskArns: [] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false
    });
  });

  it('should return false for isRunning when there is a running task but not a test task', async () => {
    mockEcs.mockImplementationOnce(() => {
      return {
        promise() {
          // listTasks
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task' ] });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          // describeTasks
          return Promise.resolve({ tasks: [{ group: 'other' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false
    });
  });

  it('should return false for isRunning when there are running tasks but not test tasks', async () => {
    mockEcs.mockImplementationOnce(() => {
      return {
        promise() {
          // listTasks
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task1' ], nextToken: 'next' });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          // describeTasks
          return Promise.resolve({ tasks: [{ group: 'other' }] });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          // listTasks
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task2' ] });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          // describeTasks
          return Promise.resolve({ tasks: [{ group: 'other' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false
    });
  });

  it('should return true for isRunning when there is a running test task', async () => {
    mockEcs.mockImplementationOnce(() => {
      return {
        promise() {
          // listTasks
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task' ] });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          // describeTasks
          return Promise.resolve({ tasks: [{ group: 'xyz' }] });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: true
    });
  });

  it('should return prefix when prefix is provided', async () => {
    mockEcs.mockImplementation(() => {
      return {
        promise() {
          // listTasks
          return Promise.resolve({ taskArns: [] });
        }
      };
    });

    event.prefix = 'prefix';
    const response = await lambda.handler(event);
    expect(response).toEqual({
      scenario: event.scenario,
      isRunning: false,
      prefix: 'prefix'
    });
  });

  it('should throw an error when listTasks fails', async () => {
    mockEcs.mockImplementation(() => {
      return {
        promise() {
          // listTasks
          return Promise.reject('listTasks error');
        }
      };
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(error).toEqual('listTasks error');
    }
  });

  it('should throw an error when describeTasks fails', async () => {
    mockEcs.mockImplementationOnce(() => {
      return {
        promise() {
          // listTasks
          return Promise.resolve({ taskArns: [ 'arn:of:ecs:task' ] });
        }
      };
    }).mockImplementationOnce(() => {
      return {
        promise() {
          // describeTasks
          return Promise.reject('describeTasks error');
        }
      };
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(error).toEqual('describeTasks error');
    }
  });
})