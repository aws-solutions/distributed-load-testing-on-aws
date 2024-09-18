// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: process.env.CONSOLE_URL,
    supportFile: "src/cypress/support/e2e.ts",
    specPattern: "src/cypress/e2e/*.cy.ts",
    viewportWidth: 1920,
    viewportHeight: 1080,
    defaultCommandTimeout: 10000,
    video: true,
    env: {
      USERNAME: process.env.USERNAME,
      PASSWORD: process.env.PASSWORD,
    },
    testIsolation: false, // we want to use the same session across all tests
  },
});
