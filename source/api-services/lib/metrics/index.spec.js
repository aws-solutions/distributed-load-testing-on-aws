// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");
const MockAdapter = require("axios-mock-adapter");

const lambda = require("./index.js");

const _taskCount = 30;

describe("#SEND METRICS", () => {
  it('should return "200" on a send metrics success for simple test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({ taskCount: _taskCount, testType: "simple" });
    expect(response).toEqual(200);
  });

  it('should return "200" on a send metrics success for zip JMeter test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({ taskCount: _taskCount, testType: "jmeter", fileType: "zip" });
    expect(response).toEqual(200);
  });

  it('should return "200" on a send metrics success for script JMeter test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({ taskCount: _taskCount, testType: "jmeter" });
    expect(response).toEqual(200);
  });

  it('should return "Network Error" on connection timedout', async () => {
    let mock = new MockAdapter(axios);
    mock.onPut().networkError();

    await lambda.send({ taskCount: _taskCount, testType: "simple" }).catch((err) => {
      expect(err.toString()).toEqual("TypeError: Cannot read properties of undefined (reading 'status')");
    });
  });
});
