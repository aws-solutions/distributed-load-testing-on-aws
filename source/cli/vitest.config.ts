// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "clover", "json", ["lcov", { projectRoot: "../../" }]],
      include: ["src/**/*.ts"],
      exclude: ["src/lib/types.ts", "src/generated-version.ts", "src/lib/auth/index.ts", "src/index.ts"],
    },
  },
});
