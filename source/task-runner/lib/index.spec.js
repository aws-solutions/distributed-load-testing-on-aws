// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockAWS = require('aws-sdk');
const mockDynamoDb = {
	update: jest.fn()
};
const mockEcs = {
	runTask: jest.fn()
};
mockAWS.ECS = jest.fn(() => ({
	runTask: mockEcs.runTask
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
	update: mockDynamoDb.update
}));

// Mock Date
const now = new Date();
global.Date = jest.fn(() => now);
global.Date.getTime = now.getTime();

process.env = {
	API_INTERVAL: '0.01',
	SCENARIOS_BUCKET: 'mock-bucket',
	SUBNET_A: 'mock-subnet-a',
	SUBNET_B: 'mock-subnet-b',
	TASK_DEFINITION: 'mock-task-definition',
	TASK_CLUSTER: 'mock-cluster',
	TASK_SECURITY_GROUP: 'mock-security-group',
	TASK_IMAGE: 'mock-task-image',
};

const lambda = require('../index.js');
const event = {
	scenario: {
		testId: 'testId',
		taskCount: 5,
		testType: 'simple',
		fileType: 'none'
	},
	isRunning: false
};
const prefix = now.toISOString().replace('Z', '').split('').reverse().join('');
const mockParam = {
	taskDefinition: process.env.TASK_DEFINITION,
	cluster: process.env.TASK_CLUSTER,
	count: 0,
	group: event.scenario.testId,
	launchType: 'FARGATE',
	networkConfiguration: {
		awsvpcConfiguration: {
			assignPublicIp: 'ENABLED',
			securityGroups: [ process.env.TASK_SECURITY_GROUP ],
			subnets: [
				process.env.SUBNET_A,
				process.env.SUBNET_B
			]
		}
	},
	overrides: {
		containerOverrides: [{
			name: process.env.TASK_IMAGE,
			environment: [
				{ name: 'S3_BUCKET', value: process.env.SCENARIOS_BUCKET },
				{ name: 'TEST_ID', value: event.scenario.testId },
				{ name: 'TEST_TYPE', value: 'simple' },
				{ name: 'FILE_TYPE', value: 'none' },
				{ name: 'PREFIX', value: prefix }
			]
		}]
	},
};

describe('#TASK RUNNER:: ', () => {
	beforeEach(() => {
		mockEcs.runTask.mockReset();
		mockDynamoDb.update.mockReset();
	});

	it('should return scenario and prefix when running ECS tasks succeeds', async () => {
		mockEcs.runTask.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		});

		const response = await lambda.handler(event);
		expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 5 });
		expect(response).toEqual({ scenario: event.scenario, prefix });
	});
	it('should return scenario and prefix when running more than 10 ECS tasks succeeds', async () => {
		mockEcs.runTask.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		});

		event.scenario.taskCount = 20;
		const response = await lambda.handler(event);
		expect(mockEcs.runTask).toHaveBeenNthCalledWith(1, { ...mockParam, count: 10 });
		expect(mockEcs.runTask).toHaveBeenNthCalledWith(2, { ...mockParam, count: 10 });
		expect(response).toEqual({ scenario: event.scenario, prefix });
	});
	it('should return scenario and prefix when API_INTERVAL is not provided but running ECS tasks succeeds', async () => {
		mockEcs.runTask.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		});

		process.env.API_INTERVAL = undefined;
		event.scenario.taskCount = 1;
		const response = await lambda.handler(event);
		expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
		expect(response).toEqual({ scenario: event.scenario, prefix });
	});

	it('should throw "ECS ERROR" when ECS.runTask fails', async () => {
		mockEcs.runTask.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.reject('ECS ERROR');
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
			event.scenario.taskCount = 1;
			await lambda.handler(event);
		} catch (error) {
			expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
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
					':e': 'Failed to run Fargate tasks.'
        }
      });
			expect(error).toEqual('ECS ERROR');
		}
	});
	it('should throw an error when DynamoDB.DocumentClient.update fails and not update the DynamoDB', async () => {
		mockEcs.runTask.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.reject('ECS ERROR');
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
			expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
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
					':e': 'Failed to run Fargate tasks.'
        }
      });
			expect(error).toEqual('DynamoDB.DocumentClient.update failed');
		}
	});
});