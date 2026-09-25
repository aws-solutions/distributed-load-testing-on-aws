// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { superviseProcess } from "../../src/process/process-supervisor.js";

describe("superviseProcess", () => {
  it("resolves with natural exit when the child completes on its own", async () => {
    const ac = new AbortController();
    const result = await superviseProcess({
      command: "node",
      args: ["-e", "process.exit(0)"],
      abortSignal: ac.signal,
      gracePeriodMs: 5000,
    });

    expect(result.stopReason).toBe("natural");
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
  });

  it("propagates non-zero exit codes", async () => {
    const ac = new AbortController();
    const result = await superviseProcess({
      command: "node",
      args: ["-e", "process.exit(42)"],
      abortSignal: ac.signal,
      gracePeriodMs: 5000,
    });

    expect(result.exitCode).toBe(42);
    expect(result.stopReason).toBe("natural");
  });

  it("reports a child that exits naturally from a signal", async () => {
    const result = await superviseProcess({
      command: "sh",
      args: ["-c", "kill -TERM $$"],
      abortSignal: new AbortController().signal,
      gracePeriodMs: 5000,
    });

    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(result.stopReason).toBe("natural");
  });

  it("calls onAbort and SIGKILLs when child doesn't exit in time", async () => {
    const ac = new AbortController();
    const onAbort = vi.fn(async () => {
      /* no-op */
    });

    const promise = superviseProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 30000)"],
      abortSignal: ac.signal,
      onAbort,
      gracePeriodMs: 100,
    });

    await new Promise((r) => setTimeout(r, 50));
    ac.abort();

    const result = await promise;

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("killed");
    expect(result.signal).toBe("SIGKILL");
  });

  it("counts a hanging onAbort callback against the grace period", async () => {
    const ac = new AbortController();
    const onAbort = vi.fn(
      () =>
        new Promise<void>(() => {
          /* deliberately unresolved */
        })
    );

    const promise = superviseProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 30000)"],
      abortSignal: ac.signal,
      onAbort,
      gracePeriodMs: 100,
    });

    await new Promise((r) => setTimeout(r, 50));
    ac.abort();

    const result = await promise;

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("killed");
    expect(result.signal).toBe("SIGKILL");
  });

  it("reports 'aborted' when child exits during grace period", async () => {
    const ac = new AbortController();

    const promise = superviseProcess({
      command: "node",
      args: ["-e", "setTimeout(() => process.exit(0), 100)"],
      abortSignal: ac.signal,
      onAbort: async () => {
        /* no-op */
      },
      gracePeriodMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 20));
    ac.abort();

    const result = await promise;
    expect(result.stopReason).toBe("aborted");
    expect(result.exitCode).toBe(0);
  });

  it("SIGKILLs when onAbort throws and child doesn't exit in time", async () => {
    const ac = new AbortController();

    const promise = superviseProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 30000)"],
      abortSignal: ac.signal,
      onAbort: () => Promise.reject(new Error("stoptest.sh not found")),
      gracePeriodMs: 100,
    });

    await new Promise((r) => setTimeout(r, 50));
    ac.abort();

    const result = await promise;

    expect(result.stopReason).toBe("killed");
    expect(result.signal).toBe("SIGKILL");
  });

  it("resolves with exitCode: null when command does not exist", async () => {
    const ac = new AbortController();
    const result = await superviseProcess({
      command: "/nonexistent/binary",
      args: [],
      abortSignal: ac.signal,
      gracePeriodMs: 5000,
    });

    expect(result.exitCode).toBeNull();
    expect(result.stopReason).toBe("natural");
  });

  it("handles abortSignal that is already aborted at call time", async () => {
    const ac = new AbortController();
    ac.abort();

    const result = await superviseProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 30000)"],
      abortSignal: ac.signal,
      gracePeriodMs: 100,
    });

    expect(["aborted", "killed"]).toContain(result.stopReason);
  });
});
