// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const utils = require("../utils");

describe("#GET OPTIONS:: ", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("should return an empty object if no solution ID or versions are not provided", () => {
    let options = {};
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an empty object if no solution ID or versions are provided as empty strings", () => {
    process.env.SOLUTION_ID = " ";
    process.env.SOLUTION_VERSION = " ";
    let options = {};
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an unchanged object", () => {
    let options = {
      region: "us-west-2",
    };
    options = utils.getOptions(options);
    expect(options).toEqual({ region: "us-west-2" });
  });

  it("should return an empty object if no solution ID is an empty string", () => {
    process.env.SOLUTION_ID = " ";
    process.env.SOLUTION_VERSION = "testVersion";
    let options = {};
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an empty object if no version is provided", () => {
    process.env.SOLUTION_ID = "SOxxx";
    process.env.SOLUTION_VERSION = " ";
    let options = {};
    options = utils.getOptions(options);
    expect(options).toEqual({});
  });

  it("should return an object with the custom agent user string set", () => {
    process.env.SOLUTION_ID = "SOxxx";
    process.env.SOLUTION_VERSION = "testVersion";
    let options = {};
    options = utils.getOptions(options);
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
