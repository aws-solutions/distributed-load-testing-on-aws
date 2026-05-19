// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";

// ---------------------------------------------------------------------------
// Status coloring
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, (s: string) => string> = {
  completed: chalk.green,
  complete: chalk.green,
  running: chalk.yellow,
  pending: chalk.yellow,
  provisioning: chalk.yellow,
  failed: chalk.red,
  cancelled: chalk.red,
  canceled: chalk.red,
};

/**
 * Apply semantic color to a test run / scenario status string.
 * Returns the original string if no color mapping exists.
 */
export function colorStatus(status: string): string {
  const fn = STATUS_COLORS[status.toLowerCase()];
  return fn ? fn(status) : status;
}

// ---------------------------------------------------------------------------
// Error count coloring
// ---------------------------------------------------------------------------

/**
 * Color an error count red when the value is > 0.
 */
export function colorErrors(val: unknown): string {
  if (val === undefined || val === null || val === "") return String(val ?? "");
  const n = Number(val);
  const s = String(val);
  if (!isNaN(n) && n > 0) return chalk.red(s);
  return s;
}

// ---------------------------------------------------------------------------
// Baseline delta coloring (semantic-aware)
// ---------------------------------------------------------------------------

export type MetricDirection = "throughput" | "latency" | "errors";

/**
 * Apply semantic color to a baseline delta string.
 *
 * - **throughput** metrics (requests, success): increase (+) is good → green, decrease (-) → red
 * - **latency** metrics (avgResponseTime, p50, p90, p99): decrease (-) is good → green, increase (+) → red
 * - **errors**: increase (+) is bad → red, decrease (-) is good → green
 * - `"--"` (no comparison) → dim gray
 */
export function colorDelta(deltaText: string, direction: MetricDirection): string {
  if (deltaText === "--") return chalk.dim(deltaText);
  if (deltaText === "0.0%") return chalk.dim(deltaText);

  const isPositive = deltaText.startsWith("+");
  const isNegative = deltaText.startsWith("-");

  if (!isPositive && !isNegative) return deltaText;

  switch (direction) {
    case "throughput":
      // More throughput is good
      return isPositive ? chalk.green(deltaText) : chalk.red(deltaText);
    case "latency":
      // Less latency is good
      return isNegative ? chalk.green(deltaText) : chalk.red(deltaText);
    case "errors":
      // Fewer errors is good
      return isNegative ? chalk.green(deltaText) : chalk.red(deltaText);
    default:
      return deltaText;
  }
}

// ---------------------------------------------------------------------------
// Baseline run marker
// ---------------------------------------------------------------------------

/**
 * Append a "◆ baseline" marker to a value, colored cyan when colors are active.
 * In non-color mode (piping), the marker still appears as plain text.
 */
export function markAsBaseline(text: string): string {
  return `${text} ${chalk.cyan("◆ baseline")}`;
}

// ---------------------------------------------------------------------------
// Table structure coloring
// ---------------------------------------------------------------------------

/** Bold text for table headers. */
export function colorHeader(text: string): string {
  return chalk.bold(text);
}

/** Dim text for table separators. */
export function colorSeparator(text: string): string {
  return chalk.dim(text);
}

// ---------------------------------------------------------------------------
// ANSI utilities
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes from a string to get the visible length.
 */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, "");
}

/**
 * Get the visible (display) length of a string, ignoring ANSI escape codes.
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Pad a string to a target visible width, accounting for ANSI escape codes.
 * Works like String.padEnd but measures visible characters only.
 */
export function padEndVisible(str: string, targetWidth: number): string {
  const visible = visibleLength(str);
  if (visible >= targetWidth) return str;
  return str + " ".repeat(targetWidth - visible);
}
