// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import "@testing-library/jest-dom";
import { Amplify } from "aws-amplify";
import { afterAll, afterEach, beforeAll } from "vitest";
import { MOCK_SERVER_URL, server } from "./__tests__/server";

// The MSW (Mock Service Worker) can't intercept Amplify API calls with the native fetch. The following statement loads web APIs from undici in order to enable MSW to intercept Amplify API calls.
import { fetch, Headers, Request, Response } from 'undici';

Object.assign(globalThis, {
  fetch,
  Headers,
  Request,
  Response,
});

process.env.TZ = "UTC"; // fix environment timezone for tests to UTC

beforeAll(() => {
  // Start MSW server before configuring Amplify
  server.listen({ onUnhandledRequest: "warn" });

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: "",
        userPoolClientId: "",
      },
    },
    API: {
      REST: {
        "solution-api": {
          endpoint: MOCK_SERVER_URL,
        },
      },
    },
  });
});
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
