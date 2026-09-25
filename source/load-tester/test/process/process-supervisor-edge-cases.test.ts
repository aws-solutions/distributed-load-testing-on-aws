// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { superviseProcess } from "../../src/process/process-supervisor.js";

describe("superviseProcess edge cases", () => {
  it("handles child exiting immediately after spawn", async () => {
    const ac = new AbortController();

    const result = await superviseProcess({
      command: "node",
      args: ["-e", "process.exit(0)"],
      abortSignal: ac.signal,
      gracePeriodMs: 5000,
    });

    expect(result.stopReason).toBe("natural");
    expect(result.exitCode).toBe(0);
  });

  it("handles gracePeriodMs of 0 (immediate SIGKILL after onAbort)", async () => {
    const ac = new AbortController();

    const promise = superviseProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 30000)"],
      abortSignal: ac.signal,
      onAbort: async () => {
        /* no-op */
      },
      gracePeriodMs: 0,
    });

    await new Promise((r) => setTimeout(r, 50));
    ac.abort();

    const result = await promise;
    expect(result.stopReason).toBe("killed");
  });

  it("handles multiple rapid abort calls without double-killing", async () => {
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
    ac.abort();
    ac.abort();

    const result = await promise;
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(["aborted", "killed"]).toContain(result.stopReason);
  });

  it("resolves with aborted when child exits during grace period", async () => {
    const ac = new AbortController();

    const promise = superviseProcess({
      command: "node",
      args: ["-e", "setTimeout(() => process.exit(42), 50); setInterval(() => {}, 1000)"],
      abortSignal: ac.signal,
      onAbort: async () => {
        /* no-op */
      },
      gracePeriodMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 30));
    ac.abort();

    const result = await promise;
    expect(result.stopReason).toBe("aborted");
    expect(result.exitCode).toBe(42);
  });

  it("tees stderr while retaining only its final 8 KiB", async () => {
    const ac = new AbortController();
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true)
      .mockImplementationOnce(() => {
        setImmediate(() => process.stderr.emit("drain"));
        return false;
      });

    const result = await superviseProcess({
      command: "sh",
      args: ["-c", "head -c 9000 /dev/zero | tr '\\0' x >&2; printf tail >&2"],
      abortSignal: ac.signal,
      gracePeriodMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stopReason).toBe("natural");
    expect(Buffer.byteLength(result.stderrTail)).toBeLessThanOrEqual(8 * 1024);
    expect(result.stderrTail.endsWith("tail")).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("resolves on exit even when a spawned process keeps the stderr pipe open", async () => {
    // The background `sleep` shares the shell's error output and outlives it, so
    // nothing ever signals that the output is finished and "close" never arrives. A
    // leftover process from a customer's JMeter plan behaves the same way. The 2 s
    // limit below is what makes this a regression test: waiting for "close" would not
    // return until the sleep ends. The sleep is short so the stray process cannot
    // outlive the test run itself.
    const result = await superviseProcess({
      command: "sh",
      args: ["-c", "printf boom >&2; sleep 3 & exit 7"],
      abortSignal: new AbortController().signal,
      gracePeriodMs: 5000,
    });

    expect(result.exitCode).toBe(7);
    expect(result.stopReason).toBe("natural");
    expect(result.stderrTail).toContain("boom");
  }, 2_000);
});
