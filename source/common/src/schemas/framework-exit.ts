// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { LoadTestFramework } from "../test-execution.ts";

export const DLT_FRAMEWORK_EXIT_V1_SCHEMA = "dlt.framework-exit.v1" as const;

/** Per-task details from a framework that exited non-zero on its own. */
export interface DltFrameworkExitV1 {
  readonly schema: typeof DLT_FRAMEWORK_EXIT_V1_SCHEMA;
  readonly timestamp: string;
  readonly testId: string;
  readonly testRunId: string;
  readonly taskId: string;
  readonly region: string;
  readonly framework: LoadTestFramework;
  readonly exitCode: number;
  readonly message: string;
  readonly stopReason: "natural";
}
