// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockAWS = require('aws-sdk');
const { run } = require('jest');
const mockDynamoDb = {
	update: jest.fn(),
	get: jest.fn()
};
const mockEcs = {
	runTask: jest.fn(),
	listTasks: jest.fn(), 
	describeTasks: jest.fn()
};
const mockCloudWatch = {
	putDashboard: jest.fn(),
	getDashboard: jest.fn()
};
const mockCloudWatchLogs = {
	putMetricFilter: jest.fn()
}

mockAWS.ECS = jest.fn(() => ({
	runTask: mockEcs.runTask,
	listTasks: mockEcs.listTasks,
	describeTasks: mockEcs.describeTasks
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
	update: mockDynamoDb.update,
	get: mockDynamoDb.get
}));
mockAWS.CloudWatch = jest.fn(() => ({
	putDashboard: mockCloudWatch.putDashboard,
	getDashboard: mockCloudWatch.getDashboard
}));
mockAWS.CloudWatchLogs = jest.fn(() => ({
	putMetricFilter: mockCloudWatchLogs.putMetricFilter,
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
	ECS_LOG_GROUP: 'mock-ecs-log-group',
	SOLUTION_ID: 'SO0062',
	VERSION: '1.3.0'
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
				{ name: 'PREFIX', value: prefix },
				{ name: 'SCRIPT', value: 'ecslistener.py'}
			]
		}]
	},
	startedBy: "testId",
	tags: [
		{key: "TestId", value: 'testId'},
		{key: "SolutionId", value: process.env.SOLUTION_ID}
	]
};

let describeTasksReturn = (numTasks, param) => {
	taskList = [];
	ipNetwork = "1.1";
	ipHosts = [];
	for(let i=0; i < numTasks; i++) {
		taskList.push({containers: [{networkInterfaces: [{privateIpv4Address: `1.1.1.${i}`}]}]});
		ipHosts.push(`1.${i}`);
	}

	param.overrides.containerOverrides[0].environment[6].value = ipNetwork.toString();
	param.overrides.containerOverrides[0].environment[7].value = ipHosts.toString();
	return taskList;
};
let getTaskIds = (numTasks) => {
	tasks = []
	for( i=0; i<numTasks; i++ ) {
		let num = i > 9 ? i - 10 : i;
		tasks.push(`a/${num}`);
	}
	return tasks
};

let runTaskReturn = (numTasks) => {
	let tasks = [];
	for(let i =0; i < numTasks; i++) {
		tasks.push({taskArn: `a/${i}`})
	}
	return tasks;
}

let mockGetRemainingTimeInMillis = () => {
	return 120000
}
let mockContext = {
	getRemainingTimeInMillis: mockGetRemainingTimeInMillis
};


describe('#TASK RUNNER:: ', () => {
	beforeEach(() => {
		mockEcs.runTask.mockReset();
		mockEcs.listTasks.mockReset();
		mockEcs.describeTasks.mockReset();
		mockDynamoDb.update.mockReset();
		mockCloudWatch.putDashboard.mockReset();
		mockCloudWatchLogs.putMetricFilter.mockReset();
	});

	it('should return scenario and prefix when running ECS worker tasks succeeds', async () => {
		mockCloudWatchLogs.putMetricFilter.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockCloudWatch.putDashboard.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});

		mockEcs.runTask.mockImplementationOnce(() => {
			let taskList = runTaskReturn(4);
				return {
					promise() {
						return Promise.resolve({
							tasks: taskList
					});
				}
			};
		});
			
		mockDynamoDb.get.mockImplementationOnce(() => {
				return {
					promise() {
						return Promise.resolve({
							Item: { status: 'running' }
					});
				}
			};
		});

		mockEcs.listTasks.mockImplementationOnce(() => {
				return {
					promise() {
						return Promise.resolve({taskArns: [1,2,3,4]});
					}
				}
			});

		const response = await lambda.handler(event, mockContext);
		let expectedResponse = {
			isRunning: true,
			scenario: event.scenario,
			prefix,
			taskRunner: {
				runTaskCount: 1,
				taskIds: ['a/0', 'a/1', 'a/2', 'a/3']
			}
		}
		expect(mockEcs.runTask).toHaveBeenCalledTimes(1);
		console.log(mockParam.overrides.containerOverrides[0].environment);
		expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 4 });
		expect(response).toEqual(expectedResponse);
	});
	it('should return scenario and prefix when running more than 10 ECS workers succeeds', async () => {
		mockCloudWatchLogs.putMetricFilter.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockCloudWatch.putDashboard.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockEcs.runTask
			.mockImplementationOnce(() => {
				let taskList = runTaskReturn(10);
				return {
					promise() {
						return Promise.resolve({
							tasks: taskList
						});
					}
				};
			})
			.mockImplementationOnce(() => {
				let taskList = runTaskReturn(9);
				return {
					promise() {
						return Promise.resolve({
							tasks: taskList
					});
				}
			};
		});

		mockDynamoDb.get.mockImplementationOnce(() => {
				return {
					promise() {
						return Promise.resolve({
							Item: { status: 'running' }
					});
				}
			};
		});

		mockEcs.listTasks.mockImplementationOnce(() => {
			let taskList = runTaskReturn(10);
			taskList = taskList.concat(runTaskReturn(9));
			return {
				promise() {
					return Promise.resolve({taskArns: taskList});
				}
			};
		});

		event.scenario.taskCount = 20;

		let tasks = getTaskIds(19);
		let expectedResponse = {
			isRunning: true,
			scenario: event.scenario,
			prefix,
			taskRunner: {
				runTaskCount: 1,
				taskIds: tasks
			}
		}
		const response = await lambda.handler(event, mockContext);
		expect(mockEcs.runTask).toHaveBeenCalledTimes(2);
		expect(mockEcs.runTask).toHaveBeenNthCalledWith(1, { ...mockParam, count: 10 });
		expect(mockEcs.runTask).toHaveBeenNthCalledWith(2, { ...mockParam, count: 9 });
		expect(response).toEqual(expectedResponse);
	});
	it('should return when launching leader task is successful', async () => {	
		mockParam.overrides.containerOverrides[0].environment[5].value = 'ecscontroller.py';
		mockParam.overrides.containerOverrides[0].environment.push({"name": "IPNETWORK", "value": ""});
		mockParam.overrides.containerOverrides[0].environment.push({"name": "IPHOSTS", "value": ""});
		event.taskRunner = {}
		let taskIds = getTaskIds(5);
		event.taskRunner.taskIds = taskIds;
		event.taskRunner.runTaskCount = 1;
		let taskList = describeTasksReturn(4, mockParam);

		mockEcs.describeTasks.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve({tasks: taskList});
				}
			};
		});

		mockEcs.runTask.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		});

		mockEcs.listTasks.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		})

		let expectedResponse = {
			isRunning: true,
			scenario: event.scenario,
			prefix,
			taskRunner: {
				runTaskCount: 0,
				taskIds: taskIds
			}
		};

		const response = await lambda.handler(event);
		expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
		expect(response).toEqual(expectedResponse);

		delete event.taskRunner;
		console.log(event);

	});
	it('should return scenario and prefix when API_INTERVAL is not provided but running ECS tasks succeeds', async () => {
		mockCloudWatchLogs.putMetricFilter.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockCloudWatch.putDashboard.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockEcs.runTask.mockImplementation(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		});

		mockEcs.listTasks.mockImplementationOnce(() => {
			return {
				promise() {
					return Promise.resolve();
				}
			};
		})

		process.env.API_INTERVAL = undefined;
		event.scenario.taskCount = 1;
		let expectedResponse = {
			isRunning: true,
			scenario: event.scenario,
			prefix,
			taskRunner: {
				runTaskCount: 0,
				taskIds: []
			}
		}
		const response = await lambda.handler(event);
		mockParam.overrides.containerOverrides[0].environment.pop();
		mockParam.overrides.containerOverrides[0].environment.pop();
		mockParam.overrides.containerOverrides[0].environment.pop();
		expect(mockEcs.runTask).toHaveBeenCalledWith({ ...mockParam, count: 1 });
		expect(response).toEqual(expectedResponse);
	});

	it('should throw "ECS ERROR" when ECS.runTask fails', async () => {
		mockCloudWatchLogs.putMetricFilter.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockCloudWatch.putDashboard.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
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
		mockCloudWatchLogs.putMetricFilter.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
		mockCloudWatch.putDashboard.mockImplementation(() =>{
			return {
				promise() {
					return Promise.resolve();
				}
			}
		});
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