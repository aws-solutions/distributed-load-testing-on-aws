// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

module.exports = {
  roots: ["<rootDir>"],
  testMatch: ["**/*.spec.js"],
  collectCoverageFrom: [
    "**/*.js",
    "!**/node_modules/**",
    "!**/coverage/**",
    "!jest.config.js",
    "!**/*.spec.js"
  ],
  coverageReporters: ["text", "clover", "json", ["lcov", { projectRoot: "../../" }]],
};
