// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDB = jest.fn();
const mockS3 = jest.fn();
const mockCloudWatch = jest.fn();
const mockAWS = require('aws-sdk');
mockAWS.S3 = jest.fn(() => ({
	getObject: mockS3
}));
mockAWS.CloudWatch = jest.fn(() => ({
	getMetricWidgetImage: mockCloudWatch
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
	update: mockDynamoDB,
	get: mockDynamoDB
}));

// Mock xml-js
const mockParse = jest.fn();
jest.mock('xml-js', () => {
	return {
		xml2js: mockParse
	};
});

const lambda = require('./index.js');

describe('#RESULTS PARSER::', () => {
	process.env.SCENARIOS_BUCKET = 'scenario_bucket';
	const content = {
		"Key": "testfile.xml"
	}
	const testId =  'abcd';
	const xmlFile = { Body: '' };
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
	const resultJson = {
    "avg_ct": 0.23043,
    "p95_0": 4.896,
    "rc": [
    	{
    		"code": "UnknownHostException",
    		"count": "20753",
    	},
    ],
		"testDuration": 123
	};
	const finalData = [
		{
			"stats": {
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
			],
			"duration": "39"
		}
	];

	beforeEach(() => {
		mockS3.mockReset();
		mockDynamoDB.mockReset();
		mockCloudWatch.mockReset();
		mockParse.mockReset();
	});

	//Positive tests
	it('should return "SUCCESS" when parse results returns success', async () => {
		mockS3.mockImplementation(() => {
			return {
				promise() {
					// getObject
					return Promise.resolve(xmlFile);
				}
			};
		});
		mockParse.mockImplementation(() => {
			return json;
		});

		const response = await lambda.results(content, testId);
		expect(response).toEqual({ stats: resultJson, endPoints: [], duration: json.FinalStatus.TestDuration._text });
	});

	it('should return "SUCCESS" when final results returns success', async () => {
		mockDynamoDB.mockImplementationOnce(() => {
			return {
				promise() {
					// get
					return Promise.resolve({
						Item: {
							startTime: '2020-09-01 00:00:00'
						}
					});
				}
			};
		}).mockImplementationOnce(() => {
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

		const response = await lambda.finalResults(testId, finalData);
		expect(response).toEqual('success');
	});

	//Negative Tests
	it('should return "S3 ERROR" when parse results fails', async () => {
		mockS3.mockImplementation(() => {
			return {
				promise() {
					// getObject
					return Promise.reject('S3 ERROR');
				}
			};
		});

		try {
			await lambda.results(content, testId);
		} catch (error) {
			expect(error).toEqual('S3 ERROR');
		}
	});

	it('should return "XML ERROR" when parse results fails', async () => {
		mockS3.mockImplementation(() => {
			return {
				promise() {
					// getObject
					return Promise.resolve(xmlFile);
				}
			};
		});
		mockParse.mockImplementation(() => {
			throw 'XML ERROR';
		});

		try {
			await lambda.results(content, testId);
		} catch (error) {
			expect(error).toEqual('XML ERROR');
		}
	});

	it('should return "DB GET ERROR" when final results fails', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// get
					return Promise.reject('DB GET ERROR');
				}
			};
		});

		try {
			await lambda.finalResults(testId, finalData);
		} catch (error) {
			expect(error).toEqual('DB GET ERROR');
		}
	});

	it('should return "CLOUDWATCH ERROR" when final results fails', async () => {
		mockDynamoDB.mockImplementation(() => {
			return {
				promise() {
					// get
					return Promise.resolve({
						Item: {
							startTime: '2020-09-01 00:00:00'
						}
					});
				}
			};
		});
		mockCloudWatch.mockImplementation(() => {
			return {
				promise() {
					// getMetricWidgetImage
					return Promise.reject('CLOUDWATCH ERROR');
				}
			};
		});


		try {
			await lambda.finalResults(testId, finalData);
		} catch (error) {
			expect(error).toEqual('CLOUDWATCH ERROR');
		}
	});

	it('should return "DB UPDATE ERROR" when final results fails', async () => {
		mockDynamoDB.mockImplementationOnce(() => {
			return {
				promise() {
					// get
					return Promise.resolve({
						Item: {
							startTime: '2020-09-01 00:00:00'
						}
					});
				}
			};
		}).mockImplementationOnce(() => {
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
			await lambda.finalResults(testId, finalData);
		} catch (error) {
			expect(error).toEqual('DB UPDATE ERROR');
		}
	});
});
