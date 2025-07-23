// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.TZ = "UTC";
module.exports = {
  roots: ["<rootDir>/lib", "<rootDir>"],
  testMatch: ["**/*.spec.js"],
  collectCoverageFrom: ["**/*.js"],
  coverageReporters: ["text", "clover", "json", ["lcov", { projectRoot: "../../" }]],
  coveragePathIgnorePatterns: ["/node_modules/", "/coverage/", "jest.config.js"],
};
