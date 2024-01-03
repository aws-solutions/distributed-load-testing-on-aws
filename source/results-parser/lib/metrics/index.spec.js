// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");
const MockAdapter = require("axios-mock-adapter");

const lambda = require("./index.js");

const _duration = 300.0;

describe("#SEND METRICS", () => {
  it('should return "200" on a send metrics success for simple test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({ totalDuration: _duration, testType: "simple", testResult: "completed" });
    expect(response).toEqual(200);
  });

  it('should return "200" on a send metrics success for zip JMeter test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({
      totalDuration: _duration,
      testType: "jmeter",
      fileType: "zip",
      testResult: "failed",
    });
    expect(response).toEqual(200);
  });

  it('should return "200" on a send metrics success for script JMeter test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({ totalDuration: _duration, testType: "jmeter", testResult: "cancelled" });
    expect(response).toEqual(200);
  });

  it('should return "200" on a send metrics success for zip K6 test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({
      totalDuration: _duration,
      testType: "k6",
      fileType: "zip",
      testResult: "failed",
    });
    expect(response).toEqual(200);
  });

  it('should return "200" on a send metrics success for script K6 test', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});

    let response = await lambda.send({ totalDuration: _duration, testType: "k6", testResult: "cancelled" });
    expect(response).toEqual(200);
  });

  it('should return "Network Error" on connection timeout', async () => {
    let mock = new MockAdapter(axios);
    mock.onPost().networkError();

    await lambda.send({ totalDuration: _duration, testType: "simple", testResult: "completed" }).catch((err) => {
      expect(err.toString()).toEqual("TypeError: Cannot read properties of undefined (reading 'status')");
    });
  });
});
