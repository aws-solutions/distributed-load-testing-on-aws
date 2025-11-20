// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "clover", "json", ["lcov", { projectRoot: "../../" }]],
      exclude: [
        "node_modules/**",
        "test/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "dist/**",
        "coverage/**",
      ],
    },
  },
});
