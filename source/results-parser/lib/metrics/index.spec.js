// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

const lambda = require('./index.js');

const _duration = 300.0;
const _testType = 'jmeter';

describe('#SEND METRICS', () => {

	it('should return "200" on a send metrics sucess', async () => {

		let mock = new MockAdapter(axios);
		mock.onPost().reply(200, {});

		let response = await lambda.send({ duration: _duration, testType: _testType });
		expect(response).toEqual(200);
	});

	it('should return "Network Error" on connection timedout', async () => {

		let mock = new MockAdapter(axios);
		mock.onPost().networkError();

		await lambda.send({ duration: _duration, testType: _testType }).catch(err => {
			expect(err.toString()).toEqual("TypeError: Cannot read property 'status' of undefined");
		});
	});

});
