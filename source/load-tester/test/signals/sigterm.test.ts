// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { createSignalManager } from "../../src/signals/sigterm.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Parameters<typeof createSignalManager>[0]["logger"];
}

describe("createSignalManager", () => {
  let exitSpy: MockInstance;
  let originalListeners: NodeJS.SignalsListener[];

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    originalListeners = process.listeners("SIGTERM");
  });

  afterEach(() => {
    exitSpy.mockRestore();
    // Remove any listeners we added, restore originals.
    process.removeAllListeners("SIGTERM");
    for (const listener of originalListeners) {
      process.on("SIGTERM", listener);
    }
  });

  it("exits 143 when SIGTERM fires during setup phase", () => {
    createSignalManager({ logger: makeLogger() });

    process.emit("SIGTERM");

    expect(exitSpy).toHaveBeenCalledWith(143);
  });

  it("calls the abort callback during setup phase", () => {
    const onAbort = vi.fn();
    const manager = createSignalManager({ logger: makeLogger() });
    manager.setAbortCallback(onAbort);

    process.emit("SIGTERM");

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(143);
  });

  it("calls the abort callback but does NOT exit during running phase", () => {
    const onAbort = vi.fn();
    const manager = createSignalManager({ logger: makeLogger() });
    manager.setAbortCallback(onAbort);
    manager.setPhase("running");

    process.emit("SIGTERM");

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(manager.terminationRequested).toBe(true);
  });

  it("ignores SIGTERM during finalizing phase", () => {
    const onAbort = vi.fn();
    const manager = createSignalManager({ logger: makeLogger() });
    manager.setAbortCallback(onAbort);
    manager.setPhase("finalizing");

    process.emit("SIGTERM");

    expect(onAbort).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(manager.terminationRequested).toBe(true);
  });

  it("does not report termination before SIGTERM", () => {
    const manager = createSignalManager({ logger: makeLogger() });

    expect(manager.terminationRequested).toBe(false);
  });

  it("exits 0 during idle phase", () => {
    const manager = createSignalManager({ logger: makeLogger() });
    manager.setPhase("idle");

    process.emit("SIGTERM");

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("logs the current phase on every SIGTERM", () => {
    const logger = makeLogger();
    const manager = createSignalManager({ logger });
    manager.setPhase("running");

    process.emit("SIGTERM");

    expect(logger.info).toHaveBeenCalledWith({ phase: "running" }, "SIGTERM received");
  });

  it("supports changing phases mid-lifecycle", () => {
    const onAbort = vi.fn();
    const manager = createSignalManager({ logger: makeLogger() });
    manager.setAbortCallback(onAbort);

    manager.setPhase("running");
    process.emit("SIGTERM");
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    manager.setPhase("idle");
    process.emit("SIGTERM");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
