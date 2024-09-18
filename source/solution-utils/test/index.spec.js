// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const utils = require("../utils");
const axios = require("axios");
const MockAdapter = require("axios-mock-adapter");

describe("#GET OPTIONS:: ", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("should return an empty object if no solution ID or versions are not provided", () => {
    let options = {};
    process.env.SOLUTION_ID = " ";
    process.env.VERSION = " ";
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an empty object if no solution ID or versions are provided as empty strings", () => {
    process.env.SOLUTION_ID = " ";
    process.env.VERSION = " ";
    let options = {};
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an unchanged object", () => {
    let options = {
      region: "us-west-2",
    };
    process.env.SOLUTION_ID = "SOxxx";
    process.env.VERSION = "testVersion";
    options = utils.getOptions(options);
    expect(options).toEqual({ region: "us-west-2", customUserAgent: "AwsSolution/SOxxx/testVersion" });
  });

  it("should return an empty object if no solution ID is an empty string", () => {
    process.env.SOLUTION_ID = " ";
    process.env.VERSION = "testVersion";
    let options = {};
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an empty object if no version is provided", () => {
    process.env.SOLUTION_ID = "SOxxx";
    process.env.VERSION = " ";
    let options = {};
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an object with the custom agent user string set", () => {
    process.env.SOLUTION_ID = "SOxxx";
    process.env.VERSION = "testVersion";
    let options = utils.getOptions({});
    expect(options).toEqual({ customUserAgent: "AwsSolution/SOxxx/testVersion" });
  });
});

describe("#GENERATE UNIQUE ID:: ", () => {
  it("should return a unique id of length 1", () => {
    const uniqueId = utils.generateUniqueId(1);
    expect(uniqueId).toHaveLength(1);
  });

  it("should return a unique id of length 10", () => {
    const uniqueId = utils.generateUniqueId();
    expect(uniqueId).toHaveLength(10);
  });

  it("should return a unique id of length 20", () => {
    const uniqueId = utils.generateUniqueId(20);
    expect(uniqueId).toHaveLength(20);
  });
});

describe("#SEND METRICS", () => {
  beforeEach(() => {
    process.env.UUID = "MyUUID";
    process.env.SOLUTION_ID = "MySolutionID";
    process.env.VERSION = "MyVersion";
    process.env.METRIC_URL = "MyEndpoint";
  });

  afterEach(() => {
    delete process.env.UUID;
    delete process.env.SOLUTION_ID;
    delete process.env.VERSION;
    delete process.env.METRIC_URL;
  });

  it("should return 200 status code on success", async () => {
    // Arrange
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});
    const metricData = {
      Type: "TaskCompletion",
      Duration: 300.0,
      TestType: "simple",
      TestResult: "completed",
    };

    // Act
    let response = await utils.sendMetric(metricData);

    // Assert
    expect(response).toEqual(200);
  });

  it("should send metric in correct format", async () => {
    // Arrange
    let mock = new MockAdapter(axios);
    mock.onPost().reply(200, {});
    const metricData = {
      Type: "TaskCompletion",
      Duration: 300.0,
      TestType: "jmeter",
      FileType: "zip",
      TestResult: "failed",
    };
    const expectedMetricObject = {
      Solution: process.env.SOLUTION_ID,
      UUID: process.env.UUID,
      Version: process.env.VERSION,
      Data: metricData,
    };

    // Act
    await utils.sendMetric(metricData);

    // Assert
    expect(mock.history.post[0].url).toEqual(process.env.METRIC_URL);
    expect(JSON.parse(mock.history.post[0].data)).toMatchObject(expectedMetricObject);
    expect(typeof Date.parse(JSON.parse(mock.history.post[0].data).TimeStamp)).toEqual("number"); // epoch time
  });

  it("should not throw error, when metric send fails", async () => {
    // Arrange
    let mock = new MockAdapter(axios);
    mock.onPost().networkError();

    // Act
    await utils.sendMetric({});

    // Assert
    expect(mock.history.post.length).toBe(1); // called once
  });
});
