// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");
const MockAdapter = require("axios-mock-adapter");

const lambda = require("./index.js");

const _event = {
  RequestType: "Create",
  ServiceToken: "arn:aws:lambda",
  ResponseURL: "https://cloudformation",
  StackId: "arn:aws:cloudformation",
  RequestId: "1111111",
  LogicalResourceId: "Uuid",
  ResourceType: "Custom::UUID",
};

const _context = {
  logStreamName: "cloudwatch",
};

const _responseStatus = "ok";

const _responseData = {
  test: "testing",
};

describe("#CFN RESPONSE::", () => {
  it("should succeed on send cfn", async () => {
    let mock = new MockAdapter(axios);
    mock.onPut().reply(200, {});

    lambda.send(_event, _context, _responseStatus, _responseData, () => {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith(_event);
      expect("responseBody").toBeDefined();
      expect("responseBody").toHaveProperty("Status", "ok");
      expect("responseBody").toHaveProperty("StackId", "StackId");
      expect("responseBody").toHaveProperty("Data", { test: "testing" });
    });
  });

  it("should return error on connection timeout", async () => {
    let mock = new MockAdapter(axios);
    mock.onPut().networkError();

    await lambda.send(_event, _context, _responseStatus, _responseData).catch((err) => {
      expect(err.toString()).toEqual("Error: Network Error");
    });
  });
});
