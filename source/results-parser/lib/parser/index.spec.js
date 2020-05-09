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
const Jimp = require('jimp');

let AWS = require('aws-sdk-mock');
AWS.setSDK(path.resolve('./node_modules/aws-sdk'));

const lambda = require('./index.js');

describe('#RESULTS PARSER::', () => {
	const bucket = 'testbucket';
	const key = 'testfile.xml';
	const uuid = '1234';
	const testId = 'abcd';
	const jsonFile = {
		Body: Buffer.from(
	 	'{"type":"Metric","data":{"name":"sessions","type":"counter","contains":"default","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"sessions"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.035607-07:00","value":1,"tags":{"group":""}},"metric":"sessions"}\n' +
		'{"type":"Metric","data":{"name":"http_reqs","type":"counter","contains":"default","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_reqs"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":1,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_reqs"}\n' +
		'{"type":"Metric","data":{"name":"http_req_duration","type":"trend","contains":"time","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_duration"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":66.682,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_duration"}\n' +
		'{"type":"Metric","data":{"name":"http_req_blocked","type":"trend","contains":"time","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_blocked"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":359.821,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_blocked"}\n' +
		'{"type":"Metric","data":{"name":"http_req_connecting","type":"trend","contains":"time","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_connecting"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":0.157,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_connecting"}\n' +
		'{"type":"Metric","data":{"name":"http_req_tls_handshaking","type":"trend","contains":"time","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_tls_handshaking"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":277.111,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_tls_handshaking"}\n' +
		'{"type":"Metric","data":{"name":"http_req_sending","type":"trend","contains":"time","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_sending"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":2.338,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_sending"}\n' +
		'{"type":"Metric","data":{"name":"http_req_waiting","type":"trend","contains":"time","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_waiting"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":64.126,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_waiting"}\n' +
		'{"type":"Metric","data":{"name":"http_req_receiving","type":"trend","contains":"time","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"http_req_receiving"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:13.464932-07:00","value":0.218,"tags":{"error_code":"1400","group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"400","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_receiving"}\n' +
		'{"type":"Metric","data":{"name":"vus","type":"gauge","contains":"default","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"vus"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.016245-07:00","value":1,"tags":null},"metric":"vus"}\n' +
		'{"type":"Metric","data":{"name":"vus_max","type":"gauge","contains":"default","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"vus_max"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.016245-07:00","value":200,"tags":null},"metric":"vus_max"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":1,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_reqs"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":842.427,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_duration"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":0,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_blocked"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":0,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_connecting"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":0,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_tls_handshaking"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":0.098,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_sending"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":842.233,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_waiting"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.307851-07:00","value":0.096,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_receiving"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":1,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_reqs"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":400.215,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_duration"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":0,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_blocked"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":0,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_connecting"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":0,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_tls_handshaking"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":0.087,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_sending"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":400.031,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_waiting"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:14.708281-07:00","value":0.097,"tags":{"group":"","method":"POST","name":"https://cognito-idp.us-west-2.amazonaws.com/","proto":"HTTP/2.0","status":"200","tls_version":"tls1.2","url":"https://cognito-idp.us-west-2.amazonaws.com/"}},"metric":"http_req_receiving"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:15.016621-07:00","value":1,"tags":null},"metric":"vus"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:15.016621-07:00","value":200,"tags":null},"metric":"vus_max"}\n' +
		'{"type":"Metric","data":{"name":"bots_percent","type":"rate","contains":"default","tainted":null,"thresholds":[],"submetrics":null,"sub":{"name":"","parent":"","suffix":"","tags":null}},"metric":"bots_percent"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:18:34.315796-07:00","value":0,"tags":{"game":"ShootingGalleryGame","group":"","level":"2"}},"metric":"bots_percent"}\n' +
		'{"type":"Point","data":{"time":"2020-03-22T17:19:13.422518-07:00","value":1,"tags":{"game":"MagnetGame","group":"","level":"3"}},"metric":"bots_percent"}\n'
		, "utf-8")
	};
	const jsonHead = {
		ContentLength: jsonFile.Body.length
	};
	const getData = {
		Item: {
			startTime: Date.now() - 30 * 60 * 1000	// 30 minutes ago
		}
	};
	const updateData = {
		Attributes: {
			taskCount: 4,
			taskIds: [ 1, 2, 3, 4 ],
			runTime: 1234
		}
	}
	const finalData = {
		"Items": [
			{
				"results": {
					"sessions": {
						"type": "counter",
						"format": "default",
						"value": 1
					},
					"http_reqs": {
						"type": "counter",
						"format": "default",
						"value": 3
					},
					"http_req_duration": {
						"type": "trend",
						"format": "time",
						"min": 66.682,
						"max": 842.427,
						"avg": 436.4413333333334,
						"med": 400.215,
						"p90": 842.427,
						"p95": 842.427
					},
					"http_req_blocked": {
						"type": "trend",
						"format": "time",
						"min": 0,
						"max": 359.821,
						"avg": 119.94033333333334,
						"med": 0,
						"p90": 359.821,
						"p95": 359.821
					},
					"http_req_connecting": {
						"type": "trend",
						"format": "time",
						"min": 0,
						"max": 0.157,
						"avg": 0.052333333333333336,
						"med": 0,
						"p90": 0.15699999999999997,
						"p95": 0.157
					},
					"http_req_tls_handshaking": {
						"type": "trend",
						"format": "time",
						"min": 0,
						"max": 277.111,
						"avg": 92.37033333333333,
						"med": 0,
						"p90": 277.111,
						"p95": 277.111
					},
					"http_req_sending": {
						"type": "trend",
						"format": "time",
						"min": 0.087,
						"max": 2.338,
						"avg": 0.8410000000000001,
						"med": 0.098,
						"p90": 2.338,
						"p95": 2.338
					},
					"http_req_waiting": {
						"type": "trend",
						"format": "time",
						"min": 64.126,
						"max": 842.233,
						"avg": 435.4633333333333,
						"med": 400.031,
						"p90": 842.233,
						"p95": 842.233
					},
					"http_req_receiving": {
						"type": "trend",
						"format": "time",
						"min": 0.096,
						"max": 0.218,
						"avg": 0.137,
						"med": 0.097,
						"p90": 0.21800000000000003,
						"p95": 0.218
					},
					"vus": {
						"type": "gauge",
						"format": "default",
						"value": 1
					},
					"vus_max": {
						"type": "gauge",
						"format": "default",
						"value": 200
					},
					"bots_percent": {
						"type": "rate",
						"format": "default",
						"value": 0.5
					}
				},
				"uuid": "1e802481-0bcb-4cd4-974c-b6ca375db36f",
				"testId": "Ar_wFhrqx",
				"testDuration": 39,
				"ttlDel": "2019-09-04 11:41:39.8"
			},
			{
				"results": {
					"sessions": {
						"type": "counter",
						"value": 1
					},
					"http_reqs": {
						"type": "counter",
						"value": 3
					},
					"http_req_duration": {
						"type": "trend",
						"format": "time",
						"min": 66.682,
						"max": 842.427,
						"avg": 436.4413333333334,
						"med": 400.215,
						"p90": 842.427,
						"p95": 842.427
					},
					"http_req_blocked": {
						"type": "trend",
						"format": "time",
						"min": 0,
						"max": 359.821,
						"avg": 119.94033333333334,
						"med": 0,
						"p90": 359.821,
						"p95": 359.821
					},
					"http_req_connecting": {
						"type": "trend",
						"format": "time",
						"min": 0,
						"max": 0.157,
						"avg": 0.052333333333333336,
						"med": 0,
						"p90": 0.15699999999999997,
						"p95": 0.157
					},
					"http_req_tls_handshaking": {
						"type": "trend",
						"format": "time",
						"min": 0,
						"max": 277.111,
						"avg": 92.37033333333333,
						"med": 0,
						"p90": 277.111,
						"p95": 277.111
					},
					"http_req_sending": {
						"type": "trend",
						"format": "time",
						"min": 0.087,
						"max": 2.338,
						"avg": 0.8410000000000001,
						"med": 0.098,
						"p90": 2.338,
						"p95": 2.338
					},
					"http_req_waiting": {
						"type": "trend",
						"format": "time",
						"min": 64.126,
						"max": 842.233,
						"avg": 435.4633333333333,
						"med": 400.031,
						"p90": 842.233,
						"p95": 842.233
					},
					"http_req_receiving": {
						"type": "trend",
						"format": "time",
						"min": 0.096,
						"max": 0.218,
						"avg": 0.137,
						"med": 0.097,
						"p90": 0.21800000000000003,
						"p95": 0.218
					},
					"vus": {
						"type": "gauge",
						"value": 1
					},
					"vus_max": {
						"type": "gauge",
						"value": 200
					},
					"bots_percent": {
						"type": "rate",
						"value": 0.5
					}
				},
				"uuid": "961a663c-941d-4918-964a-9c708ecb7a92",
				"testId": "Ar_wFhrqx",
				"testDuration": 38,
				"ttlDel": "2019-09-04 11:59:38.6"
			}
		],
		"Count": 2,
		"ScannedCount": 12
	}

	function getObject(params, callback) {
		let first = 0;
		let last = jsonFile.Body.length;
		if (params.Range) {
			const [s1,s2] = params.Range.slice('bytes='.length).split('-');
			first = parseInt(s1);
			last = parseInt(s2) + 1;
		}
		const chunkBody = jsonFile.Body.slice(first, last);
		callback(null, { Body: chunkBody, ContentLength: chunkBody.length });
	}

	// Positive tests
	it('should return "SUCCESS" when parse results returns success', async () => {
		AWS.mock('S3', 'headObject', Promise.resolve(jsonHead));
		AWS.mock('S3', 'getObject', getObject);
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.resolve(updateData));
		const response = await lambda.results(bucket, key, uuid, testId, 1024)	// <- small chunk size to test chunked S3 reads
		expect(response.taskCount).to.equal(4);
	});

	it('should return "SUCCESS" when final results returns success', async () => {
		AWS.restore('DynamoDB.DocumentClient');
		AWS.mock('DynamoDB.DocumentClient', 'scan', Promise.resolve(finalData));
		AWS.mock('DynamoDB.DocumentClient', 'get', Promise.resolve(getData));
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.resolve(updateData));
		const image = await Jimp.read(3, 3);
		const imageData = {
			MetricWidgetImage: await image.getBufferAsync(Jimp.MIME_PNG)
		};
		AWS.mock('CloudWatch', 'getMetricWidgetImage', Promise.resolve(imageData));
		const response = await lambda.finalResults(testId)
		expect(response).to.equal('success');
	});

	// Negative Tests
	it('should return "S3 ERROR" when parse results fails', async () => {
		AWS.restore('S3');
		AWS.mock('S3', 'headObject', Promise.resolve(jsonHead));
		AWS.mock('S3', 'getObject', Promise.reject('S3 ERROR'));
		await lambda.results(bucket, key, uuid, testId).catch(err => {
			expect(err).to.equal('S3 ERROR');
		});
	});

	it('should return "DB ERROR" when parse results fails', async () => {
		AWS.restore('S3');
		AWS.mock('S3', 'headObject', Promise.resolve(jsonHead));
		AWS.mock('S3', 'getObject', getObject);
		AWS.restore('DynamoDB.DocumentClient');
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.reject('DB ERROR'));
		await lambda.results(bucket, key, uuid, testId).catch(err => {
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
		AWS.mock('DynamoDB.DocumentClient', 'get', Promise.resolve(getData));
		AWS.mock('DynamoDB.DocumentClient', 'update', Promise.reject('DB UPDATE ERROR'));
		await lambda.finalResults(testId).catch(err => {
			expect(err).to.equal('DB UPDATE ERROR');
		});
	});

});
