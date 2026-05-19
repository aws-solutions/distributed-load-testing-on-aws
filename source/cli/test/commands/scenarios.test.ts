// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock("../../src/lib/api-client.js", () => ({
  ApiClient: {
    create: vi.fn(async () => ({
      get: mockApiGet,
      post: mockApiPost,
    })),
  },
}));

vi.mock("../../src/lib/output.js", () => ({
  printResult: vi.fn(),
  formatOption: vi.fn(() => {
    const { Option } = require("commander");
    return new Option("--format <format>", "Output format").default("table");
  }),
}));

vi.mock("../../src/lib/error-handler.js", () => ({
  withErrorHandler: (fn: Function) => fn,
}));

const mockStartScenario = vi.fn();
vi.mock("../../src/lib/scenario-launcher.js", () => ({
  startScenario: (...args: unknown[]) => mockStartScenario(...args),
}));

vi.mock("../../src/lib/run-formatters.js", () => ({
  ACTIVE_STATUSES: new Set(["running", "pending", "provisioning"]),
  formatTimestamp: vi.fn((ts: string) => ts),
  curateRunRow: vi.fn((r: Record<string, unknown>) => r),
  colorRunRow: vi.fn((r: Record<string, unknown>) => r),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/color.js", () => ({
  colorStatus: vi.fn((s: string) => s),
}));

import { registerScenariosCommand } from "../../src/commands/scenarios.js";
import { printResult } from "../../src/lib/output.js";

describe("scenarios command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerScenariosCommand(program);
    return program;
  }

  it("registers scenarios command with subcommands", () => {
    const program = createProgram();
    const scenarios = program.commands.find((c) => c.name() === "scenarios");
    expect(scenarios).toBeDefined();
    const subcmds = scenarios!.commands.map((c) => c.name());
    expect(subcmds).toContain("list");
    expect(subcmds).toContain("get");
    expect(subcmds).toContain("start");
  });

  describe("scenarios list", () => {
    it("lists scenarios in table format", async () => {
      mockApiGet.mockResolvedValue({
        Items: [
          { testId: "t1", testName: "Test 1", status: "completed", startTime: "2024-01-01" },
          { testId: "t2", testName: "Test 2", status: "running" },
        ],
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "list"]);

      expect(mockApiGet).toHaveBeenCalledWith("/scenarios");
      expect(printResult).toHaveBeenCalled();
    });

    it("lists scenarios in JSON format", async () => {
      mockApiGet.mockResolvedValue({ Items: [] });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "list", "--format", "json"]);

      expect(printResult).toHaveBeenCalled();
    });
  });

  describe("scenarios get", () => {
    it("gets a scenario in table format", async () => {
      mockApiGet.mockResolvedValue({
        testId: "t1",
        testName: "Test 1",
        testType: "simple",
        status: "completed",
        testScenario: { execution: [{ taskCount: 5, concurrency: 10, "ramp-up": "1m", "hold-for": "5m" }] },
        testTaskConfigs: [{ region: "us-east-1" }],
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "get", "t1"]);

      expect(mockApiGet).toHaveBeenCalledWith("/scenarios/t1?history=false&latest=false");
      expect(printResult).toHaveBeenCalled();
    });

    it("gets a scenario in JSON format", async () => {
      mockApiGet.mockResolvedValue({
        testId: "t1",
        testName: "Test 1",
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "get", "t1", "--format", "json"]);

      expect(printResult).toHaveBeenCalled();
    });

    it("handles scenario with string testScenario", async () => {
      mockApiGet.mockResolvedValue({
        testId: "t1",
        testName: "Test 1",
        testScenario: "not an object",
        testTaskConfigs: [],
      });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "get", "t1"]);

      expect(printResult).toHaveBeenCalled();
    });
  });

  describe("scenarios start", () => {
    it("starts a scenario by testId", async () => {
      mockStartScenario.mockResolvedValue({ testId: "t1", status: "running" });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "start", "t1"]);

      expect(mockStartScenario).toHaveBeenCalled();
      expect(printResult).toHaveBeenCalled();
    });

    it("starts a scenario by name", async () => {
      mockApiGet.mockResolvedValue({
        Items: [{ testId: "t1", testName: "My Test" }],
      });
      mockStartScenario.mockResolvedValue({ testId: "t1", status: "running" });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "start", "--name", "My Test"]);

      expect(mockStartScenario).toHaveBeenCalled();
    });

    it("throws when no scenario matches name", async () => {
      mockApiGet.mockResolvedValue({ Items: [] });

      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "scenarios", "start", "--name", "Nonexistent"])).rejects.toThrow(
        "No scenario found"
      );
    });

    it("throws when multiple scenarios match name", async () => {
      mockApiGet.mockResolvedValue({
        Items: [
          { testId: "t1", testName: "Dup" },
          { testId: "t2", testName: "Dup" },
        ],
      });

      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "scenarios", "start", "--name", "Dup"])).rejects.toThrow(
        "Multiple scenarios match"
      );
    });

    it("throws when no testId or name provided", async () => {
      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "scenarios", "start"])).rejects.toThrow(
        "Provide at least one testId"
      );
    });

    it("handles start failure for one scenario", async () => {
      mockStartScenario.mockRejectedValue(new Error("start failed"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      program.exitOverride(false as never);
      await program.parseAsync(["node", "dlt", "scenarios", "start", "t1"]);

      expect(printResult).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("starts multiple scenarios", async () => {
      mockStartScenario.mockResolvedValue({ testId: "t1", status: "running" });

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "scenarios", "start", "t1", "t2"]);

      expect(mockStartScenario).toHaveBeenCalledTimes(2);
    });

    it("throws when --poll-interval is not a number", async () => {
      mockStartScenario.mockResolvedValue({ testId: "t1", status: "running" });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "dlt", "scenarios", "start", "t1", "--wait", "--poll-interval", "abc"])
      ).rejects.toThrow('Invalid --poll-interval value: "abc". Must be a number (in seconds).');

      consoleSpy.mockRestore();
    });
  });
});
