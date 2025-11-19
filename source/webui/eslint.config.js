// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-useless-constructor": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/setupTests.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        vi: "readonly",
        global: "readonly",
      },
    },
  },
  {
    ignores: ["**/node_modules/**", "**/*.config.ts", "**/dist/**", "**/cdk.out/**", "**/metrics-utils/**/*.js"],
  },
];
