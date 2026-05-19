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
  },
  moduleNameMapper: {
    // @amzn/dlt-common is consumed as TS source (no build step). Its barrel
    // uses ESM-style .js extensions in imports. This mapper strips the .js
    // so Jest resolves to the .ts files via babel-jest.
    // 
    // When compiling for Lambda packages, esbuild is used which handles ESM 
    // imports correctly.
    "^(\\.{1,2}/.*)\\.js$": "$1"
  }
};
