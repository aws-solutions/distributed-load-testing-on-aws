// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Turns how a supervised process died into the exit code a RunnerRunResult reports.

import os from "node:os";

/** Maps a terminating signal to the shell's 128 + signal-number convention. */
export function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === null) return 1;
  return 128 + os.constants.signals[signal];
}
