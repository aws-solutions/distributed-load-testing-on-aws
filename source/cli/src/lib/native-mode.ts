// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Native run mode support for `scenarios create` / `scenarios update`.
 *
 * Native mode runs a test through a framework's own runner (Locust or k6's
 * native CLI, or JMeter directly) rather than through the Taurus wrapper that
 * Standard mode uses. The wire contract is a `nativeRunMode` object on the
 * `POST /scenarios` body, defined once in `@amzn/dlt-common` and shared by the
 * API, the orchestration Lambdas, the container, and the web UI. This module
 * builds that same object from CLI flags so the CLI produces a byte-compatible
 * request. Absence of the object means Standard.
 *
 * Native-mode tests run the load their uploaded script defines; DLT only
 * enforces the `--max-test-duration` safety timeout. The final
 * `createTestSchema` validation (run by the command before sending) still
 * enforces the duration bounds.
 */

import { MAX_TEST_DURATION_SECONDS } from "@amzn/dlt-common";
import type { NativeRunMode } from "@amzn/dlt-common";
import { parseDurationToSeconds } from "./duration.js";

// Re-exported so existing importers of the duration parser via this module keep
// working; the canonical definition now lives in duration.ts.
export { parseDurationToSeconds } from "./duration.js";

/** Every native-mode duration is bounded by the API's 24h ceiling. */
function parseNativeDuration(input: string, label: string): number {
  return parseDurationToSeconds(input, label, MAX_TEST_DURATION_SECONDS);
}

/** Raw native-mode flag values collected from Commander. */
export interface NativeModeOptions {
  maxTestDuration?: string | undefined;
}

/**
 * Assemble the `nativeRunMode` request field for a native-mode test.
 *
 * Native mode requires only `--max-test-duration`; the uploaded script is the
 * sole authority on the load it generates.
 * @param options Raw native-mode flag values.
 */
export function buildNativeRunMode(options: NativeModeOptions): NativeRunMode {
  if (options.maxTestDuration === undefined) {
    throw new Error("--max-test-duration is required when --native-mode is set");
  }

  return {
    maxTestDurationSeconds: parseNativeDuration(options.maxTestDuration, "--max-test-duration"),
  };
}
