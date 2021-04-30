// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDB = jest.fn();
const mockCloudWatch = jest.fn();
const mockAWS = require('aws-sdk');
mockAWS.CloudWatch = jest.fn(() => ({
	getMetricWidgetImage: mockCloudWatch
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
	update: mockDynamoDB,
}));

// Mock xml-js
const mockParse = jest.fn();
jest.mock('xml-js', () => {
	return {
		xml2js: mockParse
	};
});

process.env.SOLUTION_ID = 'SO0062';
process.env.VERSION = '1.3.0';
const lambda = require('./index.js');

describe('#RESULTS PARSER::', () => {
	process.env.SCENARIOS_BUCKET = 'scenario_bucket';
	const content = 'XML_FILE_CONTENT';
	const testId =  'abcd';
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
				},
				{
					"_attributes": {
						"label": "HTTP GET Request"
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
	const resultJson = {
    avg_ct: 0.23043,
    p95_0: 4.896,
    rc: [
    	{
    		code: 'UnknownHostException',
    		count: 20753
    	}
    ],
		testDuration: 123
	};
	const finalData = [
		{
			duration: '39',
			labels: [
				{
					avg_ct: 0.00096,
					avg_lt: 0,
					avg_rt: 0.00103,
					bytes: 48258556,
					concurrency: 4,
					fail: 21064,
					label: 'HTTP GET Request',
					p0_0: 0,
					p50_0: 0,
					p90_0: 0,
					p95_0: 0.001,
					p99_0: 0.013,
					p99_9: 0.105,
					p100_0: 0.396,
					stdev_rt: 0.01049,
					succ: 0,
					testDuration: 39,
					throughput: 21064,
					rc: [
						{ code: 'UnknownHostException', count: 20753 },
						{ code: 'UnknownHostException', count: 20753 }
					]
				}
			],
			stats: {
				avg_ct: 0.00096,
				avg_lt: 0,
				avg_rt: 0.00103,
				bytes: 48258556,
				concurrency: 4,
				fail: 21064,
				p0_0: 0,
				p50_0: 0,
				p90_0: 0,
				p95_0: 0.001,
				p99_0: 0.013,
				p99_9: 0.105,
				p100_0: 0.396,
				stdev_rt: 0.01049,
				succ: 0,
				testDuration: 39,
				throughput: 21064,
				rc: [
					{ code: 'UnknownHostException', count: 20753 },
					{ code: 'UnknownHostException', count: 20753 }
				]
			}
		}
	];
	const finalAggregatedResult = {
		avg_ct: '0.00096',
		avg_lt: '0.00000',
		avg_rt: '0.00103',
		bytes: '48258556',
		concurrency: '4',
		fail: 21064,
		p0_0: '0.000',
		p50_0: '0.000',
		p95_0: '0.001',
		p90_0: '0.000',
		p99_0: '0.013',
		p99_9: '0.105',
		p100_0: '0.396',
		rc: [ { code: 'UnknownHostException', count: 41506 } ],
		stdev_rt: '0.010',
		succ: 0,
		testDuration: '39',
		throughput: 21064,
		labels: [
			{
				avg_ct: '0.00096',
				avg_lt: '0.00000',
				avg_rt: '0.00103',
				bytes: '48258556',
				concurrency: '4',
				fail: 21064,
				label: 'HTTP GET Request',
				p0_0: '0.000',
				p50_0: '0.000',
				p95_0: '0.001',
				p90_0: '0.000',
				p99_0: '0.013',
				p99_9: '0.105',
				p100_0: '0.396',
				rc: [ { code: 'UnknownHostException', count: 41506 } ],
				stdev_rt: '0.010',
				succ: 0,
				testDuration: '39',
				throughput: 21064
			}
		]
	};
	const startTime = '2020-09-01 00:00:00'

	beforeEach(() => {
		mockDynamoDB.mockReset();
		mockCloudWatch.mockReset();
		mockParse.mockReset();
	});

	//Positive tests
	it('should return the result object when parse results are processed successfully for the single RC', async () => {
		mockParse.mockImplementation(() => {
			return json;
		});

		const response = await lambda.results(content, testId);
		expect(response).toEqual({
			stats: resultJson,
			labels: [{
				avg_ct: 0.23043,
				p95_0: 4.896,
				rc: [{
					code: 'UnknownHostException',
					count: 20753,
				}],
				label: 'HTTP GET Request'
			}],
			duration: json.FinalStatus.TestDuration._text
		});
	});
	it('should return the result object when parse results are processed successfully for the multiple RCs', async () => {
		json.FinalStatus.Group[0].rc = [
			{
				_attributes: {
					value: '20753',
					param: 'UnknownHostException'
				},
				name: {
					_text: 'rc/UnknownHostException'
				},
				value: {
					_text: 20753
				}
			},
			{
				_attributes: {
					value: '1',
					param: '200'
				},
				name: {
					_text: 'rc/200'
				},
				value: {
					_text: 1
				}
			}
		];
		json.FinalStatus.Group[1].rc = json.FinalStatus.Group[0].rc;

		mockParse.mockImplementation(() => {
			return json;
		});

		const response = await lambda.results(content, testId);
		expect(response).toEqual({
			stats: resultJson,
			labels: [{
				avg_ct: 0.23043,
				p95_0: 4.896,
				rc: [{
					code: 'UnknownHostException',
					count: 20753,
				}],
				label: 'HTTP GET Request'
			}],
			duration: json.FinalStatus.TestDuration._text
		});
	});
	it('should return the final result when final results are processed successfully', async () => {
		mockDynamoDB.mockImplementationOnce(() => {
			return {
				promise() {
					// update
					return Promise.resolve();
				}
			};
		});
		mockCloudWatch.mockImplementation(() => {
			return {
				promise() {
					// getMetricWidgetImage
					return Promise.resolve({ MetricWidgetImage: 'CloudWatchImage' });
				}
			};
		});

		const response = await lambda.finalResults(testId, finalData, startTime);
		expect(response).toEqual(finalAggregatedResult);
	});

	//Negative Tests
	it('should return "XML ERROR" when parse results fails', async () => {
		mockParse.mockImplementation(() => {
			throw 'XML ERROR';
		});

		try {
			await lambda.results(content, testId, startTime);
		} catch (error) {
			expect(error).toEqual('XML ERROR');
		}
	});
	it('should return "CLOUDWATCH ERROR" when final results fails', async () => {
		mockCloudWatch.mockImplementation(() => {
			return {
				promise() {
					// getMetricWidgetImage
					return Promise.reject('CLOUDWATCH ERROR');
				}
			};
		});

		try {
			await lambda.finalResults(testId, finalData, startTime);
		} catch (error) {
			expect(error).toEqual('CLOUDWATCH ERROR');
		}
	});
	it('should return "DB UPDATE ERROR" when final results fails', async () => {
		mockDynamoDB.mockImplementationOnce(() => {
			return {
				promise() {
					// update
					return Promise.reject('DB UPDATE ERROR');
				}
			};
		});
		mockCloudWatch.mockImplementation(() => {
			return {
				promise() {
					// getMetricWidgetImage
					return Promise.resolve({ MetricWidgetImage: 'CloudWatchImage' });
				}
			};
		});

		try {
			await lambda.finalResults(testId, finalData, startTime);
		} catch (error) {
			expect(error).toEqual('DB UPDATE ERROR');
		}
	});
});
