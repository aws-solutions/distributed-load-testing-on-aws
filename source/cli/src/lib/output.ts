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
 * Characters that spreadsheet applications may interpret as the start of a
 * formula when a CSV cell begins with them (CWE-1236 / CWE-74). Whitespace
 * characters (tab, carriage return, line feed) are included because some
 * applications strip leading whitespace after removing the surrounding CSV
 * quotes, re-exposing a following formula trigger.
 */
const CSV_FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);

/**
 * Format data as RFC 4180 CSV.
 * - Header row is derived from the keys of the first record.
 * - Values containing commas, double quotes, or newlines are enclosed in double quotes.
 * - Double quotes within values are escaped by doubling them.
 * - Values beginning with a formula-triggering character (=, +, -, @, or tab)
 *   are prefixed with a single quote so spreadsheet applications treat them as
 *   inert text rather than executing them as formulas (CSV injection).
 */
export function formatCsv(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "";

  const keys = Object.keys(data[0]!);

  const escapeCsvField = (val: unknown): string => {
    let str: string;
    let isString = false;
    if (val === null || val === undefined) str = "";
    else if (typeof val === "string") {
      str = val;
      isString = true;
    } else if (typeof val === "number" || typeof val === "boolean") str = String(val);
    else str = JSON.stringify(val);
    // Neutralize spreadsheet formula injection before RFC 4180 quoting. Only
    // string values can carry a user-supplied formula payload; numbers and
    // booleans can never be interpreted as formulas, so prefixing them (e.g.
    // rewriting -5 to '-5) would needlessly corrupt legitimate numeric cells.
    if (isString && str.length > 0 && CSV_FORMULA_TRIGGERS.has(str[0]!)) {
      str = `'${str}`;
    }
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replaceAll('"', '""')}"`;
    }
    return str;
  };

  const header = keys.map(escapeCsvField).join(",");
  const rows = data.map((row) => keys.map((k) => escapeCsvField(row[k])).join(","));

  return [header, ...rows].join("\n");
}

/**
 * Reusable Commander Option for --format with validation.
 * Rejects unknown format values at parse time.
 */
export function formatOption(): Option {
  return new Option("--format <format>", "Output format: json, table, or csv")
    .choices(["json", "table", "csv"])
    .default("table");
}

export function printResult(data: unknown, options: { format?: OutputFormat | undefined } = {}): void {
  const format = options.format ?? "table";

  // JSON format always outputs to stdout — empty arrays produce []
  if (format === "json") {
    process.stdout.write(formatJson(data) + "\n");
    return;
  }

  // Table and CSV both operate on row arrays
  let rows: Record<string, unknown>[];
  if (Array.isArray(data)) {
    rows = data as Record<string, unknown>[];
  } else if (data !== null && typeof data === "object") {
    rows = [data as Record<string, unknown>];
  } else {
    rows = [];
  }

  if (rows.length === 0) {
    console.error("(no results)");
    return;
  }

  const formatted = format === "csv" ? formatCsv(rows) : formatTable(rows);
  process.stdout.write(formatted + "\n");
}
