// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");
const MockAdapter = require("axios-mock-adapter");

const lambda = require("./index.js");

const _config = {
  SolutionId: "SO00XX",
  Version: "testVersion",
  UUID: "999-999",
  Region: "testRegion",
  existingVPC: "testTest",
};

describe("#SEND METRICS", () => {
  beforeEach(() => {
    process.env.METRIC_URL = "TestEndpoint";
  });

  afterEach(() => {
    delete process.env.METRIC_URL;
  });

  it("send metrics success", async () => {
    // Arrange
    const expected_metric_object = {
      Solution: _config.SolutionId,
      Version: _config.Version,
      UUID: _config.UUID,
      Data: {
        Type: "Create",
        Region: _config.Region,
        ExistingVpc: _config.existingVPC,
      },
    };
    const mock = new MockAdapter(axios);
    mock.onPost().reply(200);

    // Act
    await lambda.send(_config, "Create");

    // Assert
    expect(mock.history.post.length).toEqual(1); // called once
    expect(mock.history.post[0].url).toEqual(process.env.METRIC_URL);
    expect(typeof Date.parse(JSON.parse(mock.history.post[0].data).TimeStamp)).toEqual("number"); // epoch time
    expect(JSON.parse(mock.history.post[0].data)).toMatchObject(expected_metric_object);
  });

  it("should not throw error, when metric send fails", async () => {
    // Arrange
    let mock = new MockAdapter(axios);
    mock.onPost().networkError();

    // Act
    await lambda.send(_config, "Create");

    // Assert
    expect(mock.history.post.length).toBe(1); // called once
  });
});
