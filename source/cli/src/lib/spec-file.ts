// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * `--from-file` support for `scenarios create` / `update`.
 *
 * A spec file is a JSON object whose keys mirror the command's option names
 * (camelCase, e.g. `testName`, `httpEndpoint`, `maxTestDuration`). It is merged
 * in as the base layer beneath the command-line flags, so precedence is:
 * explicit flag > spec file > option default. The merged values then flow
 * through the exact same build/validation/upload path as flags, so a spec file
 * can express anything the flags can — and pairs with `--dry-run`, which prints
 * a body you can capture, tweak, and re-apply.
 */

import { readFileSync } from "node:fs";
import type { Command } from "commander";

/** Option attribute names never sourced from a spec file. */
const NON_SPEC_KEYS = new Set(["fromFile", "dryRun", "format"]);

/** Spec keys interpreted as booleans (they are `boolean` options on the command). */
const BOOLEAN_KEYS = new Set(["nativeMode", "saveOnly"]);

/**
 * Read and parse a spec file, returning its top-level object.
 * @param filePath Path to the JSON spec file.
 */
export function readSpecFile(filePath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Cannot read spec file: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Spec file is not valid JSON: ${filePath}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Spec file must contain a JSON object: ${filePath}`);
  }

  return parsed as Record<string, unknown>;
}

/**
 * Coerce a spec value to the shape the corresponding flag would produce:
 * booleans stay boolean, arrays (regions/tags) become comma strings, objects
 * (headers) become JSON strings, numbers become strings. Everything else passes
 * through unchanged.
 * @param key The option attribute name.
 * @param value The raw spec value.
 */
function normalizeSpecValue(key: string, value: unknown): unknown {
  if (BOOLEAN_KEYS.has(key)) return coerceBoolean(key, value);
  if (Array.isArray(value)) return value.join(",");
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  return value;
}

/**
 * Coerce a spec value for a boolean option, rejecting ambiguous input.
 *
 * A plain `Boolean(value)` would treat the string `"false"` as `true`, so only
 * real booleans and the explicit forms `"true"`/`"false"` and `1`/`0` are
 * accepted; anything else is an error.
 * @param key The boolean option's name.
 * @param value The raw spec value.
 */
function coerceBoolean(key: string, value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new Error(`Spec field "${key}" must be a boolean (true or false), got: ${JSON.stringify(value)}`);
}

/**
 * Merge a spec object into the command's parsed `options`, honoring
 * flag > file > default precedence.
 *
 * Only keys that name a real option on `command` are accepted; an unknown key
 * is rejected so a typo doesn't silently do nothing. A key whose flag was set
 * explicitly on the command line (or via env) is left untouched so the flag
 * wins; otherwise the spec value replaces the option's default.
 * @param options The Commander-parsed options object (mutated in place).
 * @param spec The parsed spec file object.
 * @param command The Commander command (for option names and value sources).
 */
export function applySpecFile(options: Record<string, unknown>, spec: Record<string, unknown>, command: Command): void {
  const allowed = new Set(
    command.options.map((option) => option.attributeName()).filter((name) => !NON_SPEC_KEYS.has(name))
  );

  const unknownKeys = Object.keys(spec).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    const allowedList = [...allowed].sort((a, b) => a.localeCompare(b)).join(", ");
    throw new Error(`Unknown field(s) in spec file: ${unknownKeys.join(", ")}. Allowed: ${allowedList}`);
  }

  for (const key of allowed) {
    if (!(key in spec)) continue;
    const source = command.getOptionValueSource?.(key);
    // An explicitly-provided flag wins over the file; a default does not.
    if (source === "cli" || source === "env") continue;
    options[key] = normalizeSpecValue(key, spec[key]);
  }
}
