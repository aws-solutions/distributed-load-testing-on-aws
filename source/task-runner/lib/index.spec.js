// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDB = jest.fn();
const mockEcs = jest.fn();
const mockAWS = require('aws-sdk');
mockAWS.ECS = jest.fn(() => ({
	runTask: mockEcs
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
	update: mockDynamoDB
}));

// Mock Date
const now = new Date();
global.Date = jest.fn(() => now);
global.Date.getTime = now.getTime();

const lambda = require('../index.js');

const event = {
	"scenario": {
		"testId": "testId",
		"taskCount": "5",
		"testType": "simple"
	},
	"isRunning": false
};
const prefix = now.toISOString().replace('Z', '').split('').reverse().join('');

process.env.SCENARIOS_BUCKET = 'bucket';
process.env.TASK_DEFINITION = 'task';

describe('#TASK RUNNER:: ', () => {
    beforeEach(() => {
				mockEcs.mockReset();
				mockDynamoDB.mockReset();
    });

	//Positive tests
	it('should return "SUCCESS" when "RUNTASK" returns success', async () => {
		mockEcs.mockImplementation(() => {
			return {
				promise() {
					// runTask
					return Promise.resolve();
				}
			};
		});

		const response = await lambda.handler(event);
		expect(response).toEqual({ scenario: event.scenario, prefix });
	});

	//Negative Tests
	it('should return "ECS ERROR" when "RUNTASK" fails', async () => {
		mockEcs.mockImplementation(() => {
			return {
				promise() {
					// runTask
					return Promise.reject('ECS ERROR');
				}
			};
		});
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// update
					return Promise.resolve();
				}
			};
		});

		try {
			await lambda.handler(event);
		} catch (error) {
			expect(error).toEqual('ECS ERROR');
		}
	});
});