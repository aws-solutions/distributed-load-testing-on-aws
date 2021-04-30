// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDB = jest.fn();
const mockS3 = jest.fn();
const mockStepFunctions = jest.fn();
const mockEcs = jest.fn();
const mockCloudWatch = jest.fn();
const mockCloudWatchLogs = jest.fn();
const mockCloudWatchEvents = jest.fn();
const mockLambda = jest.fn();
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
mockAWS.CloudWatch = jest.fn(() => ({
	deleteDashboards: mockCloudWatch
}));
mockAWS.CloudWatchLogs = jest.fn(() => ({
	deleteMetricFilter: mockCloudWatchLogs
}));
mockAWS.CloudWatchEvents = jest.fn(() => ({
	putRule: mockCloudWatchEvents,
	putTargets: mockCloudWatchEvents,
	removeTargets: mockCloudWatchEvents,
	deleteRule: mockCloudWatchEvents,
	listRules: mockCloudWatchEvents,
}));
mockAWS.Lambda= jest.fn(() => ({
	addPermission: mockLambda,
	removePermission: mockLambda,
	update: mockDynamoDB,
	get: mockDynamoDB,
	invoke: mockLambda
}));

Date.now = jest.fn(() => new Date("2017-04-22T02:28:37.000Z"));

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
	"taskArns": ["arn:of:task1", "arn:of:task2", "arn:of:task3"]
}

const updateData = {
	Attributes:{testStatus:'running'}
}
const config = {
	testName: "mytest",
	testDescription:"test",
	taskCount: "4",
	testScenario: {
		execution: [
			{
				"concurrency": "10",
				"ramp-up": "30s",
				"hold-for": "1m"
			}
		]
	},
	scheduleDate: "2018-02-28",
	scheduleTime: "12:30",
}

const context = {
	functionName: "lambdaFunctionName",
	invokedFunctionArn: "arn:of:lambdaFunctionName"
}

const rulesResponse = {
	Rules: [
	{
		Arn: 'arn:of:rule/123',
		Name: '123'
	}
]};

process.env.SCENARIOS_BUCKET = 'bucket';
process.env.STATE_MACHINE_ARN = 'arn:of:state:machine';
process.env.LAMBDA_ARN = 'arn:of:apilambda';
process.env.TASK_CANCELER_ARN = 'arn:of:taskCanceler';
process.env.SOLUTION_ID = 'SO0062';
process.env.VERSION = '1.3.0';

const lambda = require('./index.js');

describe('#SCENARIOS API:: ', () => {
	beforeEach(() => {
		mockS3.mockReset();
		mockDynamoDB.mockReset();
		mockStepFunctions.mockReset();
		mockEcs.mockReset();
		mockCloudWatch.mockReset();
		mockCloudWatchEvents.mockReset();
		mockLambda.mockReset();
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
		mockEcs.mockImplementationOnce(() => {
			return {
				promise() {
					// listTasks
					return Promise.resolve(tasks);
				}
			};
		});
		mockEcs.mockImplementationOnce(() =>{
			return {
				promise() {
					//describeTasks
					return Promise.resolve({
						tasks: [
							{group: testId},
							{group: testId},
							{group: "notTestId"}
						]
					});
				}
			}
		});

		

		const response = await lambda.getTest(testId);
		expect(response.name).toEqual('mytest');
	});

	it('should return "SUCCESS" when "listTask" returns success', async () => {
		mockEcs.mockImplementationOnce(() => {
			tasks.nextToken = "true";
			return {
				promise() {
					// listTasks
					return Promise.resolve(tasks);
				}
			};
		});
		mockEcs.mockImplementationOnce(() => {
			delete tasks.nextToken;
			return {
				promise() {
					// listTasks
					return Promise.resolve(tasks);
				}
			};
		});


		const response = await lambda.listTasks();
		expect(response).toEqual(tasks.taskArns);
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

		mockCloudWatchLogs.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockCloudWatch.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		});

		mockCloudWatchEvents.mockImplementationOnce(() => {

			return {
				promise() {
					return Promise.resolve(rulesResponse);
				}
			}
		});
		mockCloudWatchEvents.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		
		const response = await lambda.deleteTest(testId, context.functionName);
		expect(response).toEqual('success');
	});
	it('DELETE should return "SUCCESS" when no metrics are found', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// delete
					return Promise.resolve();
				}
			};
		});

		mockCloudWatchLogs.mockImplementation(() => {
			return {
				promise() {
					return Promise.reject({
						code: 'ResourceNotFoundException',
						statusCode: 400
					});
				}
			}
		});
		mockCloudWatch.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		});

		mockCloudWatchEvents.mockImplementationOnce(() => {

			return {
				promise() {
					return Promise.resolve(rulesResponse);
				}
			}
		});
		mockCloudWatchEvents.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		
		const response = await lambda.deleteTest(testId, context.functionName);
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
	it('should record proper date when "CREATETEST" with daily recurrence', async () => {
		config.recurrence = "daily";
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
		expect(mockDynamoDB).toHaveBeenCalledWith(expect.objectContaining({
			ExpressionAttributeValues: expect.objectContaining({
				":nr": "2017-04-23 02:28:37"
			})
		}));
		//reset config
		delete config.recurrence;
	});
	it('should record proper date when "CREATETEST" with weekly recurrence', async () => {
		config.recurrence = "weekly";
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
		expect(mockDynamoDB).toHaveBeenCalledWith(expect.objectContaining({
			ExpressionAttributeValues: expect.objectContaining({
				":nr": "2017-04-29 02:28:37"
			})
		}));
		//reset config
		delete config.recurrence;
	});
	it('should record proper date when "CREATETEST" with biweekly recurrence', async () => {
		config.recurrence = "biweekly";
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
		expect(mockDynamoDB).toHaveBeenCalledWith(expect.objectContaining({
			ExpressionAttributeValues: expect.objectContaining({
				":nr": "2017-05-06 02:28:37"
			})
		}));
		//reset config
		delete config.recurrence;
	});
	it('should record proper date when "CREATETEST" with daily recurrence', async () => {
		config.recurrence = "monthly";
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
		expect(mockDynamoDB).toHaveBeenCalledWith(expect.objectContaining({
			ExpressionAttributeValues: expect.objectContaining({
				":nr": "2017-05-22 02:28:37"
			})
		}));
		//reset config
		delete config.recurrence;
	});
	it('should return SUCCESS when "CANCELTEST" finds running tasks and returns success', async() => {

		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//invoke TaskCanceler lambda function
					return Promise.resolve();
				}
			}
		});

		mockDynamoDB.mockImplementationOnce(() => {
			return {
				promise() {
					Promise.resolve();
				}
			}
		});

		const response = await lambda.cancelTest(testId);
		expect(response).toEqual("test cancelling");

	});
	it('should return SUCCESS when "SCHEDULETEST" returns success and scheduleStep is "create"', async() => {
		config.scheduleStep = 'create';
		config.recurrence = 'daily';
		eventInput = {body: JSON.stringify(config)};
		
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//listRule
					return Promise.resolve({Rules: []});
				}
			}
		});

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putRule
					return Promise.resolve(rulesResponse);
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//putPermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putTargets
					return Promise.resolve();
				}
			}
		});
		mockDynamoDB.mockImplementation(() => {
			let scheduleData = updateData;
			scheduleData.Attributes.testStatus = 'scheduled';
			return {
				promise() {
					// update
					return Promise.resolve(scheduleData);
				}
			};
		});

		const response = await lambda.scheduleTest(eventInput, context);
		expect(response.testStatus).toEqual('scheduled');

		//reset config
		delete config.recurrence;
		delete config.scheduleStep;
	});
	it('should return SUCCESS and record proper next daily run when "SCHEDULETEST" returns success when scheduleStep is start and recurrence exists', async() => {
		config.scheduleStep = 'start';
		config.recurrence = 'daily';
		eventInput = {body: JSON.stringify(config)};

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//listRule
					return Promise.resolve({Rules: []});
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putRule
					return Promise.resolve({RuleArn: 'arn:of:rule/123'});
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//putPermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putTargets
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//removePermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockDynamoDB.mockImplementation(() => {
			let scheduleData = updateData;
			scheduleData.Attributes.testStatus = 'scheduled';
			return {
				promise() {
					// update
					return Promise.resolve(scheduleData);
				}
			};
		});

		const response = await lambda.scheduleTest(eventInput, context);
		expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
			"ScheduleExpression": "rate(1 day)"
		}));
		//reset config
		delete config.recurrence;
		delete config.scheduleStep;
	});
	it('should return SUCCESS and record proper next weekly run when "SCHEDULETEST" returns success withe scheduleStep is start and recurrence exists', async() => {
		config.scheduleStep = 'start';
		config.recurrence = 'weekly';
		eventInput = {body: JSON.stringify(config)};


		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//listRule
					return Promise.resolve(rulesResponse);
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//delete target
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//delete permission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//delete rule
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putRule
					return Promise.resolve({RuleArn: 'arn:of:rule/123'});
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//putPermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putTargets
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//removePermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeRule
					return Promise.resolve();
				}
			}
		});
		mockDynamoDB.mockImplementation(() => {
			let scheduleData = updateData;
			scheduleData.Attributes.testStatus = 'scheduled';
			return {
				promise() {
					// update
					return Promise.resolve(scheduleData);
				}
			};
		});

		const response = await lambda.scheduleTest(eventInput, context);
		expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(4, expect.objectContaining({
			"ScheduleExpression": "rate(7 days)"
		}));
		//reset config
		delete config.recurrence;
		delete config.scheduleStep;
	});
	it('should return SUCCESS and record proper next biweekly run when "SCHEDULETEST" returns success withe scheduleStep is start and recurrence exists', async() => {
		config.scheduleStep = 'start';
		config.recurrence = 'biweekly';
		eventInput = {body: JSON.stringify(config)};

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//listRule
					return Promise.resolve({Rules: []});
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putRule
					return Promise.resolve({RuleArn: 'arn:of:rule/123'});
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//putPermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putTargets
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//removePermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockDynamoDB.mockImplementation(() => {
			let scheduleData = updateData;
			scheduleData.Attributes.testStatus = 'scheduled';
			return {
				promise() {
					// update
					return Promise.resolve(scheduleData);
				}
			};
		});

		const response = await lambda.scheduleTest(eventInput, context);
		expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
			"ScheduleExpression": "rate(14 days)"
		}));
		//reset config
		delete config.recurrence;
		delete config.scheduleStep;
	});
	it('should return SUCCESS and record proper next monthly run when "SCHEDULETEST" returns success and scheduleStep is start and recurrence exists', async() => {
		config.scheduleStep = 'start';
		config.recurrence = 'monthly';
		eventInput = {body: JSON.stringify(config)};

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//listRule
					return Promise.resolve({Rules: []});
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putRule
					return Promise.resolve({RuleArn: 'arn:of:rule/123'});
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//putPermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putTargets
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//removePermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockDynamoDB.mockImplementation(() => {
			let scheduleData = updateData;
			scheduleData.Attributes.testStatus = 'scheduled';
			return {
				promise() {
					// update
					return Promise.resolve(scheduleData);
				}
			};
		});

		const response = await lambda.scheduleTest(eventInput, context);
		expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
			"ScheduleExpression": "cron(30 12 28 * ? *)"
		}));
		//reset config
		delete config.recurrence;
		delete config.scheduleStep;
	});
	it('should return SUCCESS, and records proper nextRun when "SCHEDULETEST" returns success withe scheduleStep is start and no recurrence', async() => {
		config.scheduleStep = 'start';
		eventInput = {body: JSON.stringify(config)};

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//listRule
					return Promise.resolve({Rules: []});
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putRule
					return Promise.resolve({RuleArn: 'arn:of:rule/123'});
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//putPermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//putTargets
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeTargets
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//removePermission
					return Promise.resolve();
				}
			}
		});
		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//removeRule
					return Promise.resolve();
				}
			}
		});
		mockDynamoDB.mockImplementationOnce(() => {
			let scheduleData = updateData;
			scheduleData.Attributes.testStatus = 'scheduled';
			return {
				promise() {
					// update
					return Promise.resolve(scheduleData);
				}
			};
		});

		const response = await lambda.scheduleTest(eventInput, context);
		expect(response.testStatus).toEqual('scheduled');
		expect(mockDynamoDB).toHaveBeenCalledWith(expect.objectContaining({
			ExpressionAttributeValues: expect.objectContaining({
				":nr": "2018-02-28 12:30:00"
			})
		}));
		expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
			"ScheduleExpression": "cron(30 12 28 02 ? 2018)"
		}));
		delete config.scheduleStep;
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

		mockCloudWatchLogs.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});

		mockCloudWatch.mockImplementationOnce(() => {
			return {
				promise() {
					//delete dashboard
					return Promise.resolve();
				}
			};
		});	

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve(rulesResponse);
				}
			}
		});
		mockCloudWatchEvents.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});

		try {
			await lambda.deleteTest(testId, context.functionName);
		} catch (error) {
			expect(error).toEqual('DB ERROR');
		}
	});
	it('should return "METRICS ERROR" when "DELETETEST" fails due to deleteMetricFilter error other than ResourceNotFoundException', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// delete
					return Promise.resolve();
				}
			};
		});

		mockCloudWatchLogs.mockImplementationOnce(() => {
			return {
				promise() {
					//delete metrics
					return Promise.reject("METRICS ERROR");
				}
			}
		});

		mockCloudWatch.mockImplementationOnce(() => {
			return {
				promise() {
					//delete dashboard
					return Promise.resolve();
				}
			};
		});	

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve(rulesResponse);
				}
			}
		});
		mockCloudWatchEvents.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});

		try {
			await lambda.deleteTest(testId, context.functionName);
		} catch (error) {
			expect(error).toEqual('METRICS ERROR');
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
	it('should return "InvalidParamater" when "CREATETEST" fails due to task count being less than 1', async () => {
		config.taskCount = "0";

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error.code).toEqual('InvalidParameter');
		}
		
		//reset config
		config.taskCount = "4";
	});
	it('should return "InvalidParamater" when "CREATETEST" fails due to concurrency being less 1', async () => {
		config.testScenario.execution[0]["concurrency"] = 0;

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error.code).toEqual('InvalidParameter');
		}
		//reset config
		config.testScenario.execution[0]["concurrency"] = "1";
	});
	it('should return "InvalidParamater" when "CREATETEST" fails due to hold-for less than min with no units', async () => {
		config.testScenario.execution[0]["hold-for"] = 0;

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error.code).toEqual('InvalidParameter');
		}
		//reset config
		config.testScenario.execution[0]["hold-for"] = "1m";
	});
	it('should return "InvalidParamater" when "CREATETEST" fails due to hold-for less than min with units', async () => {
		config.testScenario.execution[0]["hold-for"] = "0 ms";

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error.code).toEqual('InvalidParameter');
		}
		
		//reset config
		config.testScenario.execution[0]["hold-for"] = "1m";
	});
	it('should return "InvalidParamater" when "CREATETEST" fails due to hold-for units being invalid', async () => {
		config.testScenario.execution[0]["hold-for"] = "2 seconds";

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error.code).toEqual('InvalidParameter');
		}
		//reset config
		config.testScenario.execution[0]["hold-for"] = "1m";
	});
	it('should return "InvalidParamater" when "CREATETEST" fails due to hold-for being invalid', async () => {
		config.testScenario.execution[0]["hold-for"] = "a";
		config.testType = "simple";

		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error.code).toEqual('InvalidParameter');
		}
		//reset config
		config.testScenario.execution[0]["hold-for"] = "1m";
		delete config.testType
	});
	it('should return "InvalidParamater" when "CREATETEST" fails due to recurrence being invalid', async () => {
		config.recurrence = "invalid"
		try {
			await lambda.createTest(config);
		} catch (error) {
			expect(error.code).toEqual('InvalidParameter');
		}
		//reset config
		delete config.recurrence;
	});
	it('should return InvalidParameter when "SCHEDULETEST" fails due to invalid recurrence', async() => {
		config.scheduleStep = 'start';
		config.recurrence = 'invalid';
		eventInput = {body: JSON.stringify(config)};

		mockCloudWatchEvents.mockImplementationOnce(() => {
			return {
				promise() {
					//listRule
					return Promise.resolve({Rules: []});
				}
			}
		});

		try{
			await lambda.scheduleTest(eventInput, context)
		} catch(error) {
			expect(error.code).toEqual("InvalidParameter");
		}
		//reset config
		delete config.recurrence
		delete config.scheduleStep
	});
	it('should return "DB ERROR" when CANCELTEST fails', async() => {

		mockLambda.mockImplementationOnce(() => {
			return {
				promise() {
					//invoke TaskCanceler lambda function
					return Promise.resolve();
				}
			}
		});
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// update
					return Promise.reject('DB ERROR');
				}
			};
		});

		try{
			await lambda.cancelTest(testId)
		} catch(error) {
			expect(error).toEqual("DB ERROR");
		}
	});
	it('should return "ECS ERROR" when listTasks fails', async() => {

		mockEcs.mockImplementationOnce(() => {
			return {
				promise() {
					//describtTasks
					return Promise.reject("ECS ERROR");
				}
			}
		});

		try{
			await lambda.listTasks()
		} catch(error) {
			expect(error).toEqual("ECS ERROR");
		}
	});
});
