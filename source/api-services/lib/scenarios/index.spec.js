// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDB = jest.fn();
const mockS3 = jest.fn();
const mockStepFunctions = jest.fn();
const mockEcs = jest.fn();
const mockAWS = require('aws-sdk');
mockAWS.S3 = jest.fn(() => ({
	putObject: mockS3
}));
mockAWS.StepFunctions = jest.fn(() => ({
	startExecution: mockStepFunctions
}));
mockAWS.ECS = jest.fn(() => ({
	listTasks: mockEcs,
	describeTasks: mockEcs,
	stopTask: mockEcs
}));
mockAWS.config = jest.fn(() => ({
	logger: Function
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
	scan: mockDynamoDB,
	delete: mockDynamoDB,
	update: mockDynamoDB,
	get: mockDynamoDB
}));

const testId = '1234';
const listData = {
    Items:[
        {testId:'1234'},
        {testId:'5678'}
    ]
}
const getData = {
  Item:{
    testId:'1234',
    name: 'mytest',
    status: 'running',
		testScenario:"{\"name\":\"example\"}"
  }
}

const tasks = {
  taskArns:[]
}

const updateData = {
	Attributes:{testStatus:'running'}
}
const config = {
	testName: 'mytest',
	testDescription: 'test',
	taskCount: 4,
	testScenario: {
		execution: [
			{
				concurrency: 10,
				"ramp-up": "30s",
				"hold-for": "1m"
			}
		]
	}
}

process.env.SCENARIOS_BUCKET = 'bucket';
process.env.TASK_DEFINITION = 'task';
process.env.STATE_MACHINE_ARN = 'arn:of:state:machine';

const lambda = require('./index.js');

describe('#SCENARIOS API:: ', () => {
	beforeEach(() => {
		mockS3.mockReset();
		mockDynamoDB.mockReset();
		mockStepFunctions.mockReset();
		mockEcs.mockReset();
	});

	//Positive tests
	it('should return "SUCCESS" when "LISTTESTS" returns success', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// scan
					return Promise.resolve(listData);
				}
			};
		});

		const response = await lambda.listTests();
		expect(response.Items[0].testId).toEqual('1234');
	});

	it('should return "SUCCESS" when "GETTEST" returns success', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// get
					return Promise.resolve(getData);
				}
			};
		});
		mockEcs.mockImplementation(() => {
			return {
				promise() {
					// listTasks
					return Promise.resolve(tasks);
				}
			};
		});

		const response = await lambda.getTest(testId);
		expect(response.name).toEqual('mytest');
	});

	it('should return "SUCCESS" when "DELETETEST" returns success', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// delete
					return Promise.resolve();
				}
			};
		});

		const response = await lambda.deleteTest(testId);
		expect(response).toEqual('success');
	});

	it('should return "SUCCESS" when "CREATETEST" returns success', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// update
					return Promise.resolve(updateData);
				}
			};
		});
		mockS3.mockImplementation(() => {
			return {
				promise() {
					// putObject
					return Promise.resolve();
				}
			};
		});
		mockStepFunctions.mockImplementation(() => {
			return {
				promise() {
					// startExecution
					return Promise.resolve();
				}
			};
		});

		const response = await lambda.createTest(config);
		expect(response.testStatus).toEqual('running');
	});

	//Negative Tests
	it('should return "DB ERROR" when "LISTTESTS" fails', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// scan
					return Promise.reject('DB ERROR');
				}
			};
		});

		try {
			await lambda.listTests();
		} catch (error) {
			expect(error).toEqual('DB ERROR');
		}
	});

	it('should return "DB ERROR" when "GETTEST" fails', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// get
					return Promise.reject('DB ERROR');
				}
			};
		});

		try {
			await lambda.getTest(testId);
		} catch (error) {
			expect(error).toEqual('DB ERROR');
		}
	});

	it('should return "DB ERROR" when "DELETETEST" fails', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// delete
					return Promise.reject('DB ERROR');
				}
			};
		});

		try {
			await lambda.deleteTest(testId);
		} catch (error) {
			expect(error).toEqual('DB ERROR');
		}
	});

  it('should return "STEP FUNCTIONS ERROR" when "CREATETEST" fails', async () => {
		mockS3.mockImplementation(() => {
			return {
				promise() {
					// putObject
					return Promise.resolve();
				}
			};
		});
		mockStepFunctions.mockImplementation(() => {
			return {
				promise() {
					// startExecution
					return Promise.reject('STEP FUNCTIONS ERROR');
				}
			};
		});

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error).toEqual('STEP FUNCTIONS ERROR');
		}
	});

	it('should return "DB ERROR" when "CREATETEST" fails', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// update
					return Promise.reject('DB ERROR');
				}
			};
		});
		mockS3.mockImplementation(() => {
			return {
				promise() {
					// putObject
					return Promise.resolve();
				}
			};
		});
		mockStepFunctions.mockImplementation(() => {
			return {
				promise() {
					// startExecution
					return Promise.resolve();
				}
			};
		});

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error).toEqual('DB ERROR');
		}
	});
});
