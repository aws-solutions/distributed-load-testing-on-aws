// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const mockCredentialsExist = vi.fn();
const mockClearCredentials = vi.fn();

vi.mock("../../src/lib/credentials.js", () => ({
  credentialsExist: () => mockCredentialsExist(),
  clearCredentials: () => mockClearCredentials(),
}));

vi.mock("../../src/lib/error-handler.js", () => ({
  withErrorHandler: (fn: Function) => fn,
}));

import { registerLogoutCommand } from "../../src/commands/logout.js";

describe("logout command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerLogoutCommand(program);
    return program;
  }

  it("registers the logout command", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "logout");
    expect(cmd).toBeDefined();
  });

  it("clears credentials when they exist", async () => {
    mockCredentialsExist.mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "logout"]);

    expect(mockClearCredentials).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("prints message when no credentials exist", async () => {
    mockCredentialsExist.mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "logout"]);

    expect(mockClearCredentials).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("already logged out"));
    consoleSpy.mockRestore();
  });
});
