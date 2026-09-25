// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

module.exports = {
  roots: ["<rootDir>/lib"],
  testMatch: ["**/*.spec.js"],
  moduleNameMapper: {
    "^@amzn/dlt-common/s3-keys$": "<rootDir>/../common/src/s3-keys.ts",
    "^@amzn/dlt-common/streaming-statistics$": "<rootDir>/../common/src/streaming-statistics/index.ts",
  },
  transform: {
    "^.+\\.ts$": "<rootDir>/jest-typescript-transformer.js",
  },
  collectCoverageFrom: ["**/*.js"],
  coverageReporters: ["text", "clover", "json", ["lcov", { projectRoot: "../../" }]],
};
