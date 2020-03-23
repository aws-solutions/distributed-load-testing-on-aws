/*******************************************************************************
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. 
 *
 * Licensed under the Amazon Software License (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0    
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 ********************************************************************************/

const expect = require('chai').expect;
const path = require('path');
let AWS = require('aws-sdk-mock');
AWS.setSDK(path.resolve('./node_modules/aws-sdk'));

const lambda = require('./index.js');

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
	testConfig:"{\"name\":\"example\"}"
  }
}

const tasks = {
  taskArns:[]
}

const scanData = {
	Items:[]
}

const updateData = {
	Attributes:{testStatus:'running'}
}
const config = {
	testName:'mytest',
	testDescription:'test',
	taskCount: 4,
	testConfig: {}
}

process.env.SCENARIOS_BUCKET = 'bucket';
process.env.TASK_DEFINITION = 'task';
process.env.SQS_URL = '123'


describe('#SCENARIOS API:: ', () => {

    afterEach(() => {
        AWS.restore('DynamoDB.DocumentClient');
    });

	//Possitive tests
	it('should return "SUCCESS" when "LISTTESTS" returns success', async () => {

		AWS.mock('DynamoDB.DocumentClient', 'scan', Promise.resolve(listData));

		const response = await lambda.listTests()
		expect(response.Items[0].testId).to.equal('1234');
    });

    it('should return "SUCCESS" when "GETTEST" returns success', async () => {

		AWS.mock('DynamoDB.DocumentClient', 'get', Promise.resolve(getData));
    AWS.mock('ECS', 'listTasks', Promise.resolve(tasks));

		const response = await lambda.getTest(testId)
		expect(response.name).to.equal('mytest');
	});

    it('should return "SUCCESS" when "DELETETEST" returns success', async () => {

		AWS.mock('DynamoDB.DocumentClient', 'delete', Promise.resolve());

		const response = await lambda.deleteTest(testId)
		expect(response).to.equal('success');
	});

    it('should return "SUCCESS" when "CREATETEST" returns success', async () => {
  		AWS.mock('DynamoDB.DocumentClient', 'scan', Promise.resolve(scanData));
  		AWS.mock('S3', 'putObject', Promise.resolve());
  		AWS.mock('SQS', 'sendMessage', Promise.resolve());
  		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.resolve(updateData));

		const response = await lambda.createTest(config)
		expect(response.testStatus).to.equal('running');
	});

	//Negative Tests
	it('should return "DB ERROR" when "LISTTESTS" fails', async () => {

		AWS.mock('DynamoDB.DocumentClient', 'scan',  Promise.reject('DB ERROR'));

		await lambda.listTests().catch(err => {
			expect(err).to.equal('DB ERROR');
		});
    });

    it('should return "DB ERROR" when "GETTEST" fails', async () => {

		AWS.mock('DynamoDB.DocumentClient', 'get',  Promise.reject('DB ERROR'));

		await lambda.getTest(testId).catch(err => {
			expect(err).to.equal('DB ERROR');
		});
    });
    it('should return "DB ERROR" when "DELETETEST" fails', async () => {

		AWS.mock('DynamoDB.DocumentClient', 'delete',  Promise.reject('DB ERROR'));

		await lambda.deleteTest(testId).catch(err => {
			expect(err).to.equal('DB ERROR');
		});
	});
    it('should return "ECS ERROR" when "CREATETEST" fails', async () => {

		AWS.mock('S3', 'putObject', Promise.resolve());
        AWS.mock('ECS', 'runTask', Promise.reject('ECS ERROR'));
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.resolve(updateData));

		await lambda.createTest(config).catch(err => {
			expect(err).to.equal('ECS ERROR');
		});
	});
	it('should return "DB ERROR" when "CREATETEST" fails', async () => {

		AWS.mock('S3', 'putObject', Promise.resolve());
        AWS.mock('ECS', 'runTask', Promise.resolve());
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.reject('DB ERROR'));

		await lambda.createTest(config).catch(err => {
			expect(err).to.equal('DB ERROR');
		});
	});

});
