// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Converts native-mode form values to the `POST /scenarios` wire contract. */

import type { NativeRunMode } from "@amzn/dlt-common/validation";

/**
 * Form values for native mode. The uploaded script defines its own load; DLT
 * carries only the safety-duration ceiling.
 */
export type NativeRunModeInput = {
  maxTestDurationSeconds: number;
};

/** Builds the `nativeRunMode` request field from native-mode form values. */
export const buildNativeRunMode = (input: NativeRunModeInput): NativeRunMode => ({
  maxTestDurationSeconds: input.maxTestDurationSeconds,
});
