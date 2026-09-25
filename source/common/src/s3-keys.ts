// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Canonical S3 key builders for cross-service contracts. Both the writer
// and reader of each key should import from here — changes become compile
// errors instead of runtime mismatches.

import type { FileType, LoadTestFramework } from "./test-execution.ts";

export type TestAssetFileType = Exclude<FileType, "none">;
export type TestAssetExtension = "jmx" | "js" | "py" | "ts" | "zip";

export const FRAMEWORK_EXIT_REPORT_PREFIX = "framework-exits";
export const FRAMEWORK_EXIT_REPORT_FILENAME = "framework-exits.jsonl";

export interface TestAssetObject {
  readonly extension: TestAssetExtension;
  readonly key: string;
}

const SCRIPT_EXTENSIONS: Readonly<Record<LoadTestFramework, readonly TestAssetExtension[]>> = {
  jmeter: ["jmx"],
  k6: ["ts", "js"],
  locust: ["py"],
};

export function testConfigKey(testId: string, region: string): string {
  return `test-scenarios/${testId}-${region}.json`;
}

export function testScriptKey(framework: LoadTestFramework, testId: string, extension: string): string {
  return `public/test-scenarios/${framework}/${testId}.${extension}`;
}

/**
 * The asset fileType implied by an uploaded script's filename.
 *
 * A ".zip" is an archive the container unpacks ("zip"); any other extension is a
 * plain framework script ("script"). This is the inverse of
 * {@link getTestAssetCandidates} (fileType -> candidate extensions): callers that
 * only know the uploaded filename (e.g. a scenario's `scenarios[*].script`) use
 * this to declare the matching fileType, so the value can never drift from the
 * object actually stored. The specific script extension is not validated here —
 * the asset-existence check owns that — only zip-vs-script is decided.
 */
export function fileTypeForAssetFilename(filename: string): TestAssetFileType {
  return filename.toLowerCase().endsWith(".zip") ? "zip" : "script";
}

/**
 * Returns the S3 objects a test runner can consume, in lookup order.
 */
export function getTestAssetCandidates(
  framework: LoadTestFramework,
  fileType: TestAssetFileType,
  testId: string
): readonly TestAssetObject[] {
  const extensions: readonly TestAssetExtension[] = fileType === "zip" ? ["zip"] : SCRIPT_EXTENSIONS[framework];
  return extensions.map((extension) => ({
    extension,
    key: testScriptKey(framework, testId, extension),
  }));
}

export function startSignalKey(testId: string, prefix: string, region: string): string {
  return `start-signal/${testId}/${prefix}/${region}/start`;
}

/**
 * Build task completion marker key. Append `.warning` when the task completed with warnings,
 * which the Status Checker Lambda uses to count healthy versus warning completions.
 */
export function completionMarkerKey(
  testId: string,
  prefix: string,
  region: string,
  taskId: string,
  warning = false
): string {
  let key = `results/${testId}/${prefix}/completion/${region}/${taskId}`;
  if (warning) key += ".warning";
  return key;
}

export function frameworkExitReportKey(testId: string, prefix: string): string {
  return `results/${testId}/${prefix}/${FRAMEWORK_EXIT_REPORT_PREFIX}/${FRAMEWORK_EXIT_REPORT_FILENAME}`;
}

export function artifactKeyPrefix(testId: string, prefix: string, region: string, taskId: string): string {
  return `results/${testId}/${prefix}/${region}/${taskId}`;
}

/**
 * Validate the {@link relativePath} portion of an artifact S3 key (the part after
 * `results/{testId}/{prefix}/`) for use as a local entry name — a downloaded directory tree
 * or a zip archive. Returns the name **verbatim** when safe, or `null` to skip it; never
 * rewrites it. S3 keys are attacker-influenced, so it rejects anything that could escape the
 * output dir or corrupt the terminal — splitting on both `/` and `\`:
 * - any control character (C0 `0x00–0x1F` incl. NUL, DEL `0x7F`, C1 `0x80–0x9F`) — can't
 *   occur in a real name, and would inject terminal escapes, land as a booby-trapped on-disk
 *   filename, or break S3 key round-tripping (list normalizes CR→LF, so a later GetObject 404s);
 * - any segment that is empty, `.`, `..`, or a dot/whitespace-only Windows canonicalization
 *   (`.. `, `... `) — which also covers absolute, UNC, and leading/trailing-separator forms;
 * - a Windows drive reference (`^[A-Za-z]:`, e.g. `C:`, `C:x`).
 *
 * Every other character (spaces, `:`, `#`, non-ASCII, …) is allowed — a non-traversing name is
 * at worst unportable — so colon-timestamp and arbitrary user names still download, structure
 * preserved. Pure string handling (no `node:path`): identical in the CLI and the browser.
 */
export function entryNameFor(relativePath: string): string | null {
  if (hasControlChars(relativePath)) return null; // any C0/DEL/C1 (incl. NUL) anywhere
  for (const segment of relativePath.split(/[\\/]+/)) {
    if (/^[.\s]*$/.test(segment)) return null; // empty / `.` / `..` / Windows dot-space canonicalization
    if (/^[A-Za-z]:/.test(segment)) return null; // Windows drive reference (C:, C:x, …)
  }
  return relativePath;
}

/**
 * True for a terminal control character — C0 (0x00–0x1F, including NUL and CR), DEL
 * (0x7F), or C1 (0x80–0x9F). Shared so the name validator (entryNameFor, which rejects
 * such names) and terminal-echo sanitizers (which strip them) agree on one definition.
 * Regular space (0x20) and all printable / non-ASCII code points are not control chars.
 */
export function isControlChar(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}

/**
 * True if {@link value} contains any control character ({@link isControlChar}) anywhere.
 * {@link entryNameFor} rejects such names: they can't appear in a real artifact name and
 * would inject terminal escapes / carriage-return overwrites when echoed, be written to
 * disk as a booby-trapped filename, and break S3 key round-tripping (list normalizes
 * CR→LF, so a later GetObject 404s).
 */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    if (isControlChar(ch.codePointAt(0)!)) return true;
  }
  return false;
}
