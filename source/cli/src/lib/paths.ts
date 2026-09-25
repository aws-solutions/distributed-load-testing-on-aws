// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DLT_DIR = join(homedir(), ".dlt");

/**
 * Enforce POSIX permission bits on an existing path, but only write when they
 * differ from the desired mode.
 *
 * A `mkdirSync`/`writeFileSync` `mode` option is only honored when the entry is
 * created; a pre-existing entry (restored from backup, pre-created, or manually
 * loosened) keeps its original, potentially world-readable permissions. Rather
 * than chmod unconditionally on every call, we compare the current permission
 * bits first and skip the syscall when they already match, avoiding a redundant
 * filesystem write on the common path (every CLI run after the first).
 *
 * On Windows, POSIX permission bits do not apply and chmod is effectively a
 * no-op; this is expected and harmless.
 */
export function ensureMode(path: string, mode: number): void {
  if ((statSync(path).mode & 0o777) !== mode) {
    chmodSync(path, mode);
  }
}

/**
 * Ensure ~/.dlt exists and is restricted to the owner (0700).
 */
export function ensureDltDir(): void {
  if (!existsSync(DLT_DIR)) {
    mkdirSync(DLT_DIR, { recursive: true, mode: 0o700 });
  }
  ensureMode(DLT_DIR, 0o700);
}
