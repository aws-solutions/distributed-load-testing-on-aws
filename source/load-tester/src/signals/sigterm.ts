// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// What a container SIGTERM means depends on how far the run has got, so this is
// the policy table for it. ECS sends SIGTERM, waits out the task definition's
// stopTimeout, then SIGKILLs — and that one window has to cover every phase:
//
//   setup       nothing worth keeping → abort and exit 143 now
//   running     stop the framework, then fall through to finalizing
//   finalizing  ignore it — we are mid-upload and we will use all available
//               time to upload test artifacts. Bounded only by ECS's SIGKILL.
//   idle        results are already in S3 → exit 0

import type { Logger } from "../logger.js";

export type Phase = "setup" | "running" | "finalizing" | "idle";

export interface CreateSignalManagerInput {
  readonly logger: Logger;
}

export interface SignalManager {
  readonly terminationRequested: boolean;
  setPhase(phase: Phase): void;
  setAbortCallback(fn: () => void): void;
}

export function createSignalManager(input: CreateSignalManagerInput): SignalManager {
  let phase: Phase = "setup";
  let onAbort: (() => void) | undefined;
  let terminationRequested = false;

  process.on("SIGTERM", () => {
    terminationRequested = true;
    input.logger.info({ phase }, "SIGTERM received");
    switch (phase) {
      case "setup":
        // Container is downloading scripts or waiting for the start signal.
        // Nothing useful has happened yet — abort and exit immediately.
        onAbort?.();
        process.exit(143);
        break;

      case "running":
        // Framework process is executing the test. Signal the runner to
        // initiate graceful shutdown (flush logs, write partial results)
        // then let the lifecycle continue to reduce and upload artifacts.
        onAbort?.();
        break;

      case "finalizing":
        // Artifacts are being reduced and uploaded to S3. Ignore SIGTERM
        // and continue uploading as much as possible before ECS force-kills
        // the container.
        break;

      case "idle":
        // Test is complete, all artifacts uploaded. The container is waiting
        // for ECS to drain the service. Exit cleanly.
        process.exit(0);
        break;
    }
  });

  return {
    get terminationRequested() {
      return terminationRequested;
    },
    setPhase(p: Phase) {
      phase = p;
    },
    setAbortCallback(fn: () => void) {
      onAbort = fn;
    },
  };
}
