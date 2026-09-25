// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical duration parsing for CLI flags.
 *
 * Every CLI flag that takes a duration accepts the same human format: a whole
 * number of seconds, or a whole number with a unit suffix (`s`, `m`, `h`, `d`).
 * Centralizing it here keeps that format — and its error message — identical
 * across the native-mode duration flags.
 */

/** Seconds represented by each supported duration suffix. */
const DURATION_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/** Human label for a bound expressed in seconds (e.g. 86400 -> "24h"). */
function describeBound(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/**
 * Parse a duration flag into whole seconds.
 *
 * Accepts a bare whole number (seconds) or `<int><s|m|h|d>` (e.g. `30s`, `15m`,
 * `1h`, `1d`). Fractional values are rejected. When `maxSeconds` is given, a
 * value above it is rejected with a friendly, unit-aware message so the caller
 * doesn't have to defer the bound to a downstream schema error.
 * @param input Raw flag value.
 * @param label Flag name for error messages (e.g. `--max-test-duration`).
 * @param maxSeconds Optional inclusive upper bound, in seconds.
 */
export function parseDurationToSeconds(input: string, label: string, maxSeconds?: number): number {
  const trimmed = input.trim();

  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number.parseInt(trimmed, 10);
  } else {
    const match = /^(\d+)([smhd])$/.exec(trimmed);
    if (!match?.[1] || !match[2]) {
      throw new Error(`${label} must be a whole number of seconds or a duration like 30s, 15m, 1h, or 1d`);
    }
    seconds = Number.parseInt(match[1], 10) * DURATION_UNIT_SECONDS[match[2]]!;
  }

  if (maxSeconds !== undefined && seconds > maxSeconds) {
    throw new Error(`${label} must not exceed ${describeBound(maxSeconds)} (${maxSeconds} seconds)`);
  }

  return seconds;
}
