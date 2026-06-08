// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import headerPlugin from "./header-plugin.js";

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.git/**",
      "**/cdk.out/**",
      "**/*.d.ts",
      "**/.nightswatch/**",
      "source/coverage-reports/**",
    ],
  },
  {
    // Only lint root config files and source/mcp-server
    // This will be updated as packages are migrated
    files: [
      "*.ts",
      "source/common/**/*.ts",
      "source/mcp-server/**/*.ts",
      "source/stabilization-checker/**/*.ts",
      "source/start-command/**/*.ts",
      "source/task-runner/**/*.ts",
      "source/task-status-checker/**/*.ts",
      "source/task-canceler/**/*.ts",
      "source/task-failure-handler/**/*.ts",
      "source/orphan-cleanup/**/*.ts",
      "source/regional-sync/**/*.ts",
      "source/sfn-failure-handler/**/*.ts",
      "source/test-cleanup/**/*.ts",
    ],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      header: headerPlugin,
    },
    rules: {
      "header/header": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
    },
  },
]);
