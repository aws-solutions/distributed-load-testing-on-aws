// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { withErrorHandler } from "../../src/lib/error-handler.js";

describe("withErrorHandler", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("calls the wrapped function with arguments", async () => {
    const fn = vi.fn(async (a: string, b: number) => {});
    const wrapped = withErrorHandler(fn);
    await wrapped("hello", 42);
    expect(fn).toHaveBeenCalledWith("hello", 42);
  });

  it("does not catch when function succeeds", async () => {
    const fn = vi.fn(async () => {});
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("catches errors and prints the message", async () => {
    const fn = vi.fn(async () => {
      throw new Error("test failure");
    });
    const wrapped = withErrorHandler(fn);
    await expect(wrapped()).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith("Error: test failure");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("handles non-Error thrown values", async () => {
    const fn = vi.fn(async () => {
      throw "string error";
    });
    const wrapped = withErrorHandler(fn);
    await expect(wrapped()).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith("Error: string error");
  });
});
