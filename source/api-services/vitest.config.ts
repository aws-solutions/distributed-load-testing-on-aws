// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "lib/validation/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "clover", "json", ["lcov", { projectRoot: "../../" }]],
      exclude: [
        "node_modules/**",
        "test/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.spec.js",
        "dist/**",
        "coverage/**",
      ],
    },
  },
});
