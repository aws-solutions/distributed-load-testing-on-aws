// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";

/**
 * Prompt the user to confirm overwriting an existing file or directory.
 *
 * - If `force` is true, skips the prompt entirely.
 * - If the target path does not exist, returns immediately.
 * - Otherwise asks the user for Y/n confirmation and throws if declined.
 */
export async function confirmOverwrite(targetPath: string, force: boolean): Promise<void> {
  if (force) return;
  if (!existsSync(targetPath)) return;

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await rl.question(`"${targetPath}" already exists. Overwrite? [y/N] `);
    if (answer.trim().toLowerCase() !== "y") {
      throw new Error("Aborted: not overwriting existing file.");
    }
  } finally {
    rl.close();
  }
}
