// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Extracts a user-uploaded zip to a working directory. Handles two common
// zip structures:
//   1. Files at root:      script.jmx, data.csv → extracted as-is
//   2. Single wrapper dir: my-project/script.jmx → flattened to root
//
// The flattening matches v1 behavior that users depend on — framework
// config files (e.g. locust.conf) must be at the top level.
//
// Extracts to a temp directory first, then copies to destDir on success.
// This avoids leaving partial content in destDir if extraction fails.
// Zip-slip and symlink path-traversal protection is handled by extractZip.

import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractZip, type ExtractZipSummary } from "./extract-zip.js";
import { isIgnoredTestFile } from "./ignored-files.js";
import type { Logger } from "../logger.js";

export interface UnzipInput {
  readonly zipPath: string;
  readonly destDir: string;
  /** Optional; when given, records what the extraction wrote and skipped. */
  readonly logger?: Logger;
}

export async function unzip(input: UnzipInput): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), "dlt-unzip-"));
  try {
    const summary = await extractZip(input.zipPath, resolve(workDir));
    if (summary.skippedCount > 0) {
      // Deliberately warn rather than debug. createLogger defaults to "info" and
      // no entrypoint overrides it, so a debug line never reaches CloudWatch. An
      // archive that yields some files while dropping others throws nothing, so
      // debug alone would leave that partial loss as invisible as the bug this
      // change exists to end.
      input.logger?.warn({ zipPath: input.zipPath, ...summary }, "zip entries skipped as non-regular files");
    } else {
      input.logger?.debug({ zipPath: input.zipPath, ...summary }, "zip extracted");
    }

    const sourceDir = await findSourceDir(workDir, input.zipPath, summary);

    const contents = await readdir(sourceDir, { withFileTypes: true });
    await Promise.all(
      contents
        .filter((d) => !isIgnoredTestFile(d.name))
        .map((d) => cp(join(sourceDir, d.name), join(input.destDir, d.name), { recursive: true }))
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// Determines where to copy from: if the zip extracted into a single
// wrapper directory, we use that directory's contents (flatten it).
// Otherwise we use the extraction root directly.
async function findSourceDir(extractionRoot: string, zipPath: string, summary: ExtractZipSummary): Promise<string> {
  const allEntries = await readdir(extractionRoot, { withFileTypes: true });
  const entries = allEntries.filter((entry) => !isIgnoredTestFile(entry.name));

  if (entries.length === 0) {
    throw new Error(noUsableEntriesMessage(zipPath, summary));
  }

  const [first] = entries;
  if (entries.length === 1 && first?.isDirectory()) {
    return join(extractionRoot, first.name);
  }

  return extractionRoot;
}

// An extraction that yields nothing has three distinct causes, and the one that
// applies is the whole diagnosis. Saying which it was here is the difference
// between a self-explaining container log and a run that dies on an unrelated
// ECS circuit-breaker message.
function noUsableEntriesMessage(zipPath: string, summary: ExtractZipSummary): string {
  const prefix = `Zip file "${zipPath}" contained no usable entries`;

  if (summary.filesWritten === 0 && summary.skippedCount === 0) {
    return `${prefix}: the archive holds no files at all.`;
  }

  const cause =
    summary.filesWritten === 0
      ? "no entry in it is a regular file, and symlinks, devices, and FIFOs are never extracted"
      : "nothing it extracted survived the ignored-name filter, which drops dotfiles and __MACOSX. " +
        "Rebuild the zip with the test script at its top level";
  const skipped = summary.skippedCount > 0 ? ` Skipped: ${describeSkippedEntries(summary)}.` : "";

  return `${prefix}: ${cause}.${skipped}`;
}

function describeSkippedEntries(summary: ExtractZipSummary): string {
  const named = summary.skippedEntries.map((entry) => `"${entry.name}" (mode ${entry.mode})`).join(", ");
  const unnamed = summary.skippedCount - summary.skippedEntries.length;
  return unnamed > 0 ? `${named}, and ${unnamed} more` : named;
}
