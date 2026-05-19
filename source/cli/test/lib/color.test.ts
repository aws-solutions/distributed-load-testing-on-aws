// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import chalk from "chalk";
import {
  colorStatus,
  colorErrors,
  colorDelta,
  markAsBaseline,
  colorHeader,
  colorSeparator,
  stripAnsi,
  visibleLength,
  padEndVisible,
} from "../../src/lib/color.js";

describe("color", () => {
  describe("colorStatus", () => {
    it("colors completed status green", () => {
      const result = colorStatus("completed");
      expect(result).toBe(chalk.green("completed"));
      expect(stripAnsi(result)).toBe("completed");
    });

    it("colors complete status green", () => {
      expect(colorStatus("complete")).toBe(chalk.green("complete"));
    });

    it("colors running status yellow", () => {
      expect(colorStatus("running")).toBe(chalk.yellow("running"));
    });

    it("colors pending status yellow", () => {
      expect(colorStatus("pending")).toBe(chalk.yellow("pending"));
    });

    it("colors provisioning status yellow", () => {
      expect(colorStatus("provisioning")).toBe(chalk.yellow("provisioning"));
    });

    it("colors failed status red", () => {
      expect(colorStatus("failed")).toBe(chalk.red("failed"));
    });

    it("colors cancelled status red", () => {
      expect(colorStatus("cancelled")).toBe(chalk.red("cancelled"));
    });

    it("colors canceled status red (alternate spelling)", () => {
      expect(colorStatus("canceled")).toBe(chalk.red("canceled"));
    });

    it("is case-insensitive", () => {
      expect(colorStatus("Running")).toBe(chalk.yellow("Running"));
      expect(colorStatus("FAILED")).toBe(chalk.red("FAILED"));
      expect(colorStatus("Completed")).toBe(chalk.green("Completed"));
    });

    it("returns unmodified string for unknown status", () => {
      expect(colorStatus("unknown")).toBe("unknown");
      expect(colorStatus("")).toBe("");
    });
  });

  describe("colorErrors", () => {
    it("colors non-zero error count red", () => {
      expect(colorErrors(10)).toBe(chalk.red("10"));
      expect(colorErrors(1)).toBe(chalk.red("1"));
      expect(colorErrors("5")).toBe(chalk.red("5"));
    });

    it("does not color zero errors", () => {
      const result = colorErrors(0);
      expect(result).toBe("0");
      expect(stripAnsi(result)).toBe("0");
    });

    it("does not color empty values", () => {
      expect(colorErrors("")).toBe("");
      expect(colorErrors(undefined)).toBe("");
      expect(colorErrors(null)).toBe("");
    });
  });

  describe("colorDelta", () => {
    describe("throughput direction (requests, success)", () => {
      it("colors positive deltas green (more throughput is good)", () => {
        expect(colorDelta("+25.7%", "throughput")).toBe(chalk.green("+25.7%"));
      });

      it("colors negative deltas red (less throughput is bad)", () => {
        expect(colorDelta("-7.6%", "throughput")).toBe(chalk.red("-7.6%"));
      });
    });

    describe("latency direction (avgResponseTime, p50, p90, p99)", () => {
      it("colors negative deltas green (less latency is good)", () => {
        expect(colorDelta("-15.2%", "latency")).toBe(chalk.green("-15.2%"));
      });

      it("colors positive deltas red (more latency is bad)", () => {
        expect(colorDelta("+28.0%", "latency")).toBe(chalk.red("+28.0%"));
      });
    });

    describe("errors direction", () => {
      it("colors negative deltas green (fewer errors is good)", () => {
        expect(colorDelta("-50.0%", "errors")).toBe(chalk.green("-50.0%"));
      });

      it("colors positive deltas red (more errors is bad)", () => {
        expect(colorDelta("+100.0%", "errors")).toBe(chalk.red("+100.0%"));
      });
    });

    it("dims '--' (no comparison available)", () => {
      expect(colorDelta("--", "throughput")).toBe(chalk.dim("--"));
      expect(colorDelta("--", "latency")).toBe(chalk.dim("--"));
    });

    it("dims '0.0%' (no change)", () => {
      expect(colorDelta("0.0%", "throughput")).toBe(chalk.dim("0.0%"));
    });

    it("returns unmodified string without +/- prefix", () => {
      expect(colorDelta("N/A", "throughput")).toBe("N/A");
    });
  });

  describe("markAsBaseline", () => {
    it("appends a baseline marker", () => {
      const result = markAsBaseline("run-123");
      expect(stripAnsi(result)).toBe("run-123 ◆ baseline");
    });

    it("applies cyan color to the marker", () => {
      const result = markAsBaseline("run-123");
      expect(result).toBe(`run-123 ${chalk.cyan("◆ baseline")}`);
    });
  });

  describe("colorHeader", () => {
    it("applies bold formatting", () => {
      expect(colorHeader("testRunId")).toBe(chalk.bold("testRunId"));
    });
  });

  describe("colorSeparator", () => {
    it("applies dim formatting", () => {
      const sep = "──────────";
      expect(colorSeparator(sep)).toBe(chalk.dim(sep));
    });
  });

  describe("stripAnsi", () => {
    it("removes ANSI escape codes", () => {
      expect(stripAnsi(chalk.red("hello"))).toBe("hello");
      expect(stripAnsi(chalk.bold(chalk.green("test")))).toBe("test");
    });

    it("passes through plain strings unchanged", () => {
      expect(stripAnsi("hello")).toBe("hello");
      expect(stripAnsi("")).toBe("");
    });
  });

  describe("visibleLength", () => {
    it("returns correct length for plain strings", () => {
      expect(visibleLength("hello")).toBe(5);
      expect(visibleLength("")).toBe(0);
    });

    it("returns visible length ignoring ANSI codes", () => {
      expect(visibleLength(chalk.red("hello"))).toBe(5);
      expect(visibleLength(chalk.bold(chalk.green("completed")))).toBe(9);
    });
  });

  describe("padEndVisible", () => {
    it("pads plain strings correctly", () => {
      expect(padEndVisible("hi", 5)).toBe("hi   ");
    });

    it("pads strings with ANSI codes to correct visible width", () => {
      const colored = chalk.red("hi");
      const padded = padEndVisible(colored, 5);
      // Visible content should be "hi   " (5 chars)
      expect(visibleLength(padded)).toBe(5);
      // Should still contain the ANSI codes
      expect(padded).toContain(colored);
    });

    it("does not add padding when string is already at target width", () => {
      const colored = chalk.green("hello");
      const padded = padEndVisible(colored, 5);
      expect(visibleLength(padded)).toBe(5);
    });

    it("does not truncate when string exceeds target width", () => {
      const padded = padEndVisible("hello world", 5);
      expect(padded).toBe("hello world");
    });
  });
});