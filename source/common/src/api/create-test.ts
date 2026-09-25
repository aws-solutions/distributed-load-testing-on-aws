// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Native-mode fields on the create-test request body (`POST /scenarios`).
 */

import { z } from "zod";
import { MAX_TEST_DURATION_SECONDS } from "./limits.ts";

/**
 * Safety timeout for a native-mode test. The container aborts the framework
 * process once this elapses, then still uploads whatever results it has.
 *
 * This is DLT's backstop for a script that would run indefinitely or longer
 * than the user intended. Native-mode tests run the load their uploaded script
 * defines; DLT does not override it.
 */
export const maxTestDurationSecondsSchema = z
  .number()
  .int("maxTestDurationSeconds must be an integer")
  .min(1, "maxTestDurationSeconds must be at least 1")
  .max(MAX_TEST_DURATION_SECONDS, `maxTestDurationSeconds must not exceed ${MAX_TEST_DURATION_SECONDS} (24 hours)`);

/**
 * Native traffic-shape configuration. Its presence selects Native mode, running
 * the uploaded script under the framework's own runner; omitting it selects
 * Standard mode, which runs the test through Taurus.
 */
export const nativeRunModeSchema = z.strictObject({
  maxTestDurationSeconds: maxTestDurationSecondsSchema,
});

/**
 * The native-mode field, as a plain shape so callers can spread it into a
 * larger `z.object({...})` for the full request body.
 */
export const nativeTestFieldsShape = {
  nativeRunMode: nativeRunModeSchema.optional(),
};

export type NativeRunMode = z.infer<typeof nativeRunModeSchema>;
