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
const sinon = require('sinon');
const parser = require('xml-js');
let AWS = require('aws-sdk-mock');
AWS.setSDK(path.resolve('./node_modules/aws-sdk'));

const lambda = require('./index.js');

describe('#RESULTS PARSER::', () => {

    const bucket = 'testbucket';
    const key = 'testfile.xml';
	const uuid = '1234';
	const testId =  'abcd';
	const xmlFile ={Body:''};
	const json = {
		"FinalStatus": {
			"TestDuration": {
				"_text": 123
			},
			"Group": [
				{
					"_attributes": {
						"label": ""
					},
					"avg_ct": {
						"_attributes": {
							"value": "0.23043"
						},
						"name": {
							"_text": "avg_ct"
						},
						"value": {
							"_text": 0.23043
						}
					},
					"rc": {
						"_attributes": {
							"value": "20753",
							"param": "UnknownHostException"
						},
						"name": {
							"_text": "rc/UnknownHostException"
						},
						"value": {
							"_text": 20753
						}
					},
					"perc": [
						{
							"_attributes": {
								"value": "4.89600",
								"param": "95.0"
							},
							"name": {
								"_text": "perc/95.0"
							},
							"value": {
								"_text": 4.896
							}
						}
					]
				}
			]
		}
	};
	const updateData = {
		Attributes:{
			taskCount:4,
			taskIds:[1,2,3,4],
			runTime:1234
		}
	}
	const finalData = {
		"Items": [
			{
				"results": {
					"avg_lt": 0,
					"p0_0": 0,
					"p99_0": 0.013,
					"stdev_rt": 0.01049,
					"avg_ct": 0.00096,
					"concurrency": 4,
					"p99_9": 0.105,
					"rc": [],
					"fail": 21064,
					"succ": 0,
					"p100_0": 0.396,
					"bytes": 48258556,
					"p95_0": 0.001,
					"avg_rt": 0.00103,
					"throughput": 21064,
					"p90_0": 0,
					"testDuration": 39,
					"p50_0": 0
				},
				"uuid": "1e802481-0bcb-4cd4-974c-b6ca375db36f",
				"testId": "Ar_wFhrqx",
				"testDuration": 39,
				"ttlDel": "2019-09-04 11:41:39.8",
				"endPoints": [
					{
						"avg_lt": 0,
						"p0_0": 0,
						"p99_0": 0.013,
						"stdev_rt": 0.01049,
						"avg_ct": 0.00096,
						"concurrency": 4,
						"p99_9": 0.105,
						"rc": [],
						"fail": 21064,
						"endpoint": "https://stackoverflow.com22",
						"succ": 0,
						"p100_0": 0.396,
						"bytes": 48258556,
						"p95_0": 0.001,
						"avg_rt": 0.00103,
						"throughput": 21064,
						"p90_0": 0,
						"p50_0": 0
					}
				]
			},
			{
				"results": {
					"avg_lt": 0,
					"p0_0": 0,
					"p99_0": 0.016,
					"stdev_rt": 0.01241,
					"avg_ct": 0.00116,
					"concurrency": 4,
					"p99_9": 0.195,
					"rc": [],
					"fail": 20753,
					"succ": 0,
					"p100_0": 0.412,
					"bytes": 47546055,
					"p95_0": 0.001,
					"avg_rt": 0.00121,
					"throughput": 20753,
					"p90_0": 0,
					"testDuration": 38,
					"p50_0": 0
				},
				"uuid": "961a663c-941d-4918-964a-9c708ecb7a92",
				"testId": "Ar_wFhrqx",
				"testDuration": 38,
				"ttlDel": "2019-09-04 11:59:38.6",
				"endPoints": [
					{
						"avg_lt": 0,
						"p0_0": 0,
						"p99_0": 0.016,
						"stdev_rt": 0.01241,
						"avg_ct": 0.00116,
						"concurrency": 4,
						"p99_9": 0.195,
						"rc": [],
						"fail": 20753,
						"endpoint": "https://stackoverflow.com22",
						"succ": 0,
						"p100_0": 0.412,
						"bytes": 47546055,
						"p95_0": 0.001,
						"avg_rt": 0.00121,
						"throughput": 20753,
						"p90_0": 0,
						"p50_0": 0
					}
				]
			}
		],
		"Count": 2,
		"ScannedCount": 12
	}

	const stubXml = sinon.stub(parser, 'xml2js');

	//Possitive tests
	it('should return "SUCCESS" when parse results returns success', async () => {

		AWS.mock('S3', 'getObject', Promise.resolve(xmlFile));
		stubXml.returns(json);
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.resolve(updateData));

		const response = await lambda.results(bucket,key,uuid,testId)
		expect(response.taskCount).to.equal(4);
	});

	it('should return "SUCCESS" when final results returns success', async () => {
		AWS.restore('DynamoDB.DocumentClient');
		AWS.mock('DynamoDB.DocumentClient', 'scan', Promise.resolve(finalData));
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.resolve(updateData));

		const response = await lambda.finalResults(testId)
		expect(response).to.equal('success');
	});

	//Negative Tests
	it('should return "S3 ERROR" when parse results fails', async () => {

		AWS.restore('S3');
		AWS.mock('S3', 'getObject', Promise.reject('S3 ERROR'));

		await lambda.results(bucket,key,uuid,testId).catch(err => {
			expect(err).to.equal('S3 ERROR');
		});
	});

	it('should return "XML ERROR" when parse results fails', async () => {

		AWS.restore('S3');
		AWS.mock('S3', 'getObject', Promise.resolve(xmlFile));
		stubXml.throws();

		await lambda.results(bucket,key,uuid,testId).catch(err => {
			expect(err).to.equal(err);
		});
	});

	it('should return "S3 ERROR" when parse results fails', async () => {

		AWS.restore('S3');
		AWS.restore('DynamoDB.DocumentClient');
		AWS.mock('S3', 'getObject', Promise.resolve(xmlFile));
		stubXml.returns(json);

		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.reject('DB ERROR'));

		await lambda.results(bucket,key,uuid,testId).catch(err => {
			expect(err).to.equal('DB ERROR');
		});
	});
	it('should return "DB SCAN ERROR" when final results fails', async () => {

		AWS.restore('DynamoDB.DocumentClient');
		AWS.mock('DynamoDB.DocumentClient', 'scan', Promise.reject('DB SCAN ERROR'));

		await lambda.finalResults(testId).catch(err => {
			expect(err).to.equal('DB SCAN ERROR');
		});
	});
	it('should return "DB UPDATE ERROR" when final results fails', async () => {

		AWS.restore('DynamoDB.DocumentClient');
		AWS.mock('DynamoDB.DocumentClient', 'scan', Promise.resolve(finalData));
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.reject('DB UPDATE ERROR'));

		await lambda.finalResults(testId).catch(err => {
			expect(err).to.equal('DB UPDATE ERROR');
		});
	});

});
