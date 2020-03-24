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

const lambda = require('../index.js');

const event = {
	"Records": [
		{
			"body": "{\"testId\":\"5Q106Tg\",\"taskCount\":\"1\"}"
		}
	]
};

process.env.SCENARIOS_BUCKET = 'bucket';
process.env.TASK_DEFINITION = 'task';

describe('#TASK RUNNER:: ', () => {
	afterEach(() => {
		AWS.restore('ECS');
	});

	// Positive tests
	it('should return "SUCCESS" when "RUNTASK" returns success', async () => {
		AWS.mock('ECS', 'runTask', Promise.resolve());

		const response = await lambda.handler(event)
		expect(response).to.equal('success');
	});

	// Negative Tests
	it('should return "ECS ERROR" when "RUNTASK" fails', async () => {
		AWS.mock('ECS', 'runTask', Promise.reject('ECS ERROR'));
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.resolve());

		await lambda.handler(event).catch(err => {
			expect(err).to.equal('ECS ERROR');
		});
	});
});
