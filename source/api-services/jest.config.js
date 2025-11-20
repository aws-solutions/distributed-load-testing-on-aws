// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.TZ = "UTC";
module.exports = {
  roots: ["<rootDir>/lib", "<rootDir>"],
  testMatch: ["**/*.spec.js", "**/*.spec.ts"],
  collectCoverageFrom: [
    "**/*.js",
    "**/*.ts",
    "!**/*.d.ts",
    "!**/node_modules/**",
    "!**/coverage/**"
  ],
  coverageReporters: ["text", "clover", "json", ["lcov", { projectRoot: "../../" }]],
  coveragePathIgnorePatterns: ["/node_modules/", "/coverage/", "jest.config.js"],
  coverageThreshold: {
    global: {
      branches: 81,
      functions: 81,
      lines: 81,
      statements: 81
    }
  },
  transform: {
    "^.+\\.(ts|tsx)$": ["babel-jest", { presets: ["@babel/preset-typescript"] }]
  }
};
