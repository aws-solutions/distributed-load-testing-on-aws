// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Amplify } from "aws-amplify";

/**
 * This function enables mock-service-worker (msw) in the browser, so you can do local frontend development against the mock handlers.
 *
 * Only if aws-exports.json file is NOT present or does NOT contain the API endpoint config, msw will be enabled.
 * If the API config is present, requests will be sent to the API.
 *
 * @param apiEndpoint
 */
export async function startMockServer(apiEndpoint: string) {
  const config = Amplify.getConfig();

  // if aws-exports.json is present and contains an API endpoint, do not enable mocking
  const isBackendConfigured = !!config.API?.REST?.["solution-api"]?.endpoint;

  console.log("🔧 Mock Server Debug:", {
    apiEndpoint,
    config: config.API?.REST,
    isBackendConfigured,
    willEnableMocking: !isBackendConfigured,
  });

  if (isBackendConfigured) {
    console.log("✅ Backend configured - MSW disabled");
    return Promise.resolve();
  }

  console.log("🎭 Starting Mock Service Worker...");
  const { setupWorker } = await import("msw/browser");
  const { handlers } = await import("./handlers");

  const worker = setupWorker(...handlers(apiEndpoint));
  // `worker.start()` returns a Promise that resolves
  // once the Service Worker is up and ready to intercept requests.
  return worker
    .start({
      onUnhandledRequest(request, print) {
        // Print MSW unhandled request warning, to detect requests that are not handled by MSW
        print.warning();
      },
    })
    .then(() => {
      console.log("🎭 Mock Service Worker started successfully");
    });
}
