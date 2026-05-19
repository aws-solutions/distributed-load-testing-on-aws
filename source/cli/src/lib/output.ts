// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Option } from "commander";
import type { OutputFormat } from "./types.js";
import { colorHeader, colorSeparator, visibleLength, padEndVisible, stripAnsi } from "./color.js";

/** Maximum column width for table rendering. */
const MAX_COL_WIDTH = 120;

/**
 * Convert an arbitrary cell value to a display string for table output.
 * - null / undefined → ""
 * - numbers → rounded (2dp for small, locale-formatted for large)
 * - objects / arrays → compact JSON
 */
export function cellValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return String(val);
    if (Math.abs(val) >= 10_000) return val.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return Number.isInteger(val) ? String(val) : val.toFixed(2);
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatTable(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "(no results)";

  const keys = Object.keys(data[0]!);
  const widths = new Map<string, number>();

  // Calculate column widths using visible length (ignores ANSI escape codes)
  for (const key of keys) {
    widths.set(key, key.length);
  }
  for (const row of data) {
    for (const key of keys) {
      const val = cellValue(row[key]);
      const visible = visibleLength(val);
      const current = widths.get(key) ?? 0;
      if (visible > current) {
        widths.set(key, Math.min(visible, MAX_COL_WIDTH));
      }
    }
  }

  // Header — bold
  const header = keys.map((k) => colorHeader(k.padEnd(widths.get(k) ?? 0))).join("  ");

  // Separator — dim
  const separator = colorSeparator(keys.map((k) => "─".repeat(widths.get(k) ?? 0)).join("──"));

  // Rows — pad using visible length to account for ANSI codes in cell values
  const rows = data.map((row) =>
    keys
      .map((k) => {
        const val = cellValue(row[k]);
        const w = widths.get(k) ?? 0;
        // Truncate based on visible length, then pad
        const visLen = visibleLength(val);
        if (visLen > MAX_COL_WIDTH) {
          // Truncate: strip ANSI, slice, but this is a rare edge case
          return stripAnsi(val).slice(0, MAX_COL_WIDTH).padEnd(w);
        }
        return padEndVisible(val, w);
      })
      .join("  ")
  );

  return [header, separator, ...rows].join("\n");
}

/**
 * Reusable Commander Option for --format with validation.
 * Rejects unknown format values at parse time.
 */
export function formatOption(): Option {
  return new Option("--format <format>", "Output format: json or table").choices(["json", "table"]).default("table");
}

export function printResult(data: unknown, options: { format?: OutputFormat | undefined } = {}): void {
  const format = options.format ?? "table";

  if (format === "table") {
    let rows: Record<string, unknown>[];
    if (Array.isArray(data)) {
      rows = data as Record<string, unknown>[];
    } else if (data !== null && typeof data === "object") {
      rows = [data as Record<string, unknown>];
    } else {
      rows = [];
    }

    if (rows.length === 0) {
      // Empty table: human message to stderr, nothing to stdout
      console.error("(no results)");
    } else {
      process.stdout.write(formatTable(rows) + "\n");
    }
  } else {
    // JSON format always outputs to stdout — empty arrays produce []
    process.stdout.write(formatJson(data) + "\n");
  }
}
