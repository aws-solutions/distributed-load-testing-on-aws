// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Spawns a child process (the load test framework) and supervises its lifecycle.
// Handles graceful shutdown when the abort signal fires:
//   1. Start the grace-period deadline
//   2. Invoke the caller's onAbort callback (or SIGTERM the child) to flush logs
//   3. SIGKILL if the child is still running after the grace period
//
// gracePeriodMs is the total deadline from abort for the process to flush logs
// and finalize output. Framework-specific onAbort work consumes that same budget.
//
// Callers pick the value, and they are spending a shared budget — the container's
// whole shutdown fits inside one ECS stop timeout, and every
// second spent here is a second reduce-and-upload does not get.
//
// See GRACE_PERIOD_MS in ../runners/locust.ts for an example.

import { spawn, type ChildProcess } from "node:child_process";

const STDERR_TAIL_BYTES = 8 * 1024;

// How long to wait for the framework's last error output after it exits, before we
// stop listening. Only comes into play when something else is still holding the
// connection open.
const STDERR_DRAIN_MILLISECONDS = 500;

export interface SupervisedProcessInput {
  readonly command: string;
  readonly args: string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly abortSignal: AbortSignal;
  /** Maximum time (ms) from abort to SIGKILL, including onAbort. */
  readonly gracePeriodMs: number;
  /** Framework-specific graceful-stop logic. Defaults to SIGTERM to child. */
  readonly onAbort?: () => Promise<void>;
}

/** Why the child exited. */
export type StopReason =
  | "natural" // exited on its own before any abort
  | "aborted" // abort signal fired, onAbort called, child then exited
  | "killed"; // child didn't exit within grace period, SIGKILL sent

export interface SupervisedProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stopReason: StopReason;
  readonly stderrTail: string;
}

export function superviseProcess(input: SupervisedProcessInput): Promise<SupervisedProcessResult> {
  const { command, args, abortSignal, onAbort, gracePeriodMs } = input;

  return new Promise<SupervisedProcessResult>((resolve) => {
    const child: ChildProcess = spawn(command, args, {
      stdio: ["inherit", "inherit", "pipe"],
      env: input.env,
      cwd: input.cwd,
    });

    let stopReason: StopReason = "natural";
    let graceTimer: NodeJS.Timeout | undefined = undefined;
    let drainTimer: NodeJS.Timeout | undefined = undefined;
    let stderrTail = Buffer.alloc(0);

    // Capture chunk of stderr output (up to STDERR_TAIL_BYTES)
    child.stderr?.pipe(process.stderr, { end: false });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrTail = Buffer.concat([stderrTail, bytes]).subarray(-STDERR_TAIL_BYTES);
    });

    const hasExited = (): boolean => child.exitCode !== null || child.signalCode !== null; // exit code or termination signal

    // --- Child exit handling ---

    child.on("close", (code, signal) => {
      teardown();
      resolve({ exitCode: code, signal, stopReason, stderrTail: stderrTail.toString("utf8") });
    });

    child.on("error", () => {
      teardown();
      resolve({ exitCode: null, signal: null, stopReason: "natural", stderrTail: stderrTail.toString("utf8") });
    });

    // Node reports "close" only once nothing can write to the framework's error
    // output any more. Programs the framework itself started will share the connection,
    // so one of them still running keeps it open and "close" never arrives — leaving
    // this promise unanswered, and with it everything waiting on it: saving results,
    // uploading them, and writing the marker that says this task finished. A test
    // that really did complete would be reported as failed at its time limit. So
    // once the framework is gone, wait briefly for its last output, then close our
    // own side so "close" can fire. Whatever already arrived is kept; only what a
    // leftover program writes after that point is lost.
    child.on("exit", () => {
      drainTimer = setTimeout(() => child.stderr?.destroy(), STDERR_DRAIN_MILLISECONDS);
    });

    // --- Abort handling ---

    const onAbortEvent = (): void => void initiateShutdown();
    if (abortSignal.aborted) {
      void initiateShutdown();
    } else {
      abortSignal.addEventListener("abort", onAbortEvent, { once: true });
    }

    async function initiateShutdown(): Promise<void> {
      // Child already exited — nothing to do.
      if (hasExited()) return;

      stopReason = "aborted";

      // Arm the hard deadline before framework-specific stop logic. A hung
      // onAbort callback must not consume the reduce-and-upload budget.
      graceTimer = setTimeout(() => {
        if (hasExited()) return;
        stopReason = "killed";
        child.kill("SIGKILL");
      }, gracePeriodMs);

      // Ask the framework to stop gracefully (or send SIGTERM as fallback).
      // Best-effort: a failed graceful stop still falls through to SIGKILL.
      try {
        if (onAbort) await onAbort();
        else child.kill("SIGTERM");
      } catch {
        // ignore — grace-period SIGKILL is the backstop
      }
    }

    function teardown(): void {
      abortSignal.removeEventListener("abort", onAbortEvent);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (drainTimer !== undefined) clearTimeout(drainTimer);
    }
  });
}
