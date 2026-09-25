// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Extracts a zip archive into a destination directory. This replaces the
// extract-zip package, which recreates symlink entries and is subject to
// GHSA-jmr9-qjv8-65gv: a zip can carry a symlink entry pointing outside the
// destination, then a later entry writes through that link and escapes the
// target directory. That library has no fixed release, so we extract with yauzl
// (the primitive extract-zip itself wrapped) and add two guards:
//
//   1. Symlink and other non-regular entries are skipped, never recreated, so
//      no entry can redirect a later write outside destDir. DLT test bundles and
//      JMeter plugin zips contain only regular files and directories.
//   2. Every entry's resolved path must stay within destDir (zip-slip), which
//      rejects "../" traversal and absolute paths.
//
// Only regular files and directories inside destDir are ever written.

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { stripVTControlCharacters } from "node:util";

import { open, type Entry, type ZipFile } from "yauzl";

// Unix file-type bits live in the top 16 bits of a zip entry's external file
// attributes. S_IFMT masks off the type field; a type field of 0 means the writer
// recorded no file type, which is common for plain files from many zip tools.
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;

/** Upper bound on the skipped entries named in an {@link ExtractZipSummary}. */
const MAX_REPORTED_SKIPS = 20;

/**
 * Longest entry name retained in a summary. The zip format permits a 65535-byte
 * name, and a summary holds up to {@link MAX_REPORTED_SKIPS} of them, so without
 * a bound one archive could push a log event past the 256 KB CloudWatch limit and
 * truncate away the very diagnostic the summary exists to provide.
 */
const MAX_REPORTED_NAME_LENGTH = 200;

/** Stands in for a control character that was removed from an entry name. */
const REPLACEMENT = "�";

function unixMode(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0o177777;
}

function fileType(entry: Entry): number {
  return unixMode(entry) & S_IFMT;
}

/** Formats a unix mode the way it reads in source, e.g. 0o120777. */
function formatMode(mode: number): string {
  return `0o${mode.toString(8)}`;
}

/**
 * Shapes an entry name from an uploaded archive so it is safe to put in a log or
 * an error message.
 *
 * An entry name is attacker-controlled text. When a zip sets the UTF-8 name flag,
 * yauzl decodes the name verbatim, so raw newlines, ANSI escapes, and
 * bidirectional overrides survive into whatever reads the summary. This strips VT
 * sequences, replaces every remaining control and format character, collapses
 * whitespace runs, and bounds the length. Removed characters become
 * {@link REPLACEMENT} rather than vanishing, so a name crafted to look like a
 * different file cannot quietly impersonate one.
 *
 * Deliberately not {@link https://code.amazon.com/packages/Distributed-load-testing-on-aws/blobs/mainline/--/source/common/src/task-failure.ts | sanitizeStopReason}:
 * that redacts IPs, account ids, and ARNs, which would corrupt a legitimate file
 * name such as `orders-192.168.0.1.csv` or `region-123456789012.jmx` and make the
 * diagnostic worse. Entry names carry no secrets, only untrusted formatting.
 */
function safeEntryName(fileName: string): string {
  const withoutControls = stripVTControlCharacters(fileName).replace(/[\p{Cc}\p{Cf}]/gu, REPLACEMENT);
  const collapsed = withoutControls.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_REPORTED_NAME_LENGTH
    ? `${collapsed.slice(0, MAX_REPORTED_NAME_LENGTH)}...(truncated)`
    : collapsed;
}

function isSymlink(entry: Entry): boolean {
  return fileType(entry) === S_IFLNK;
}

/**
 * True for entries safe to write as ordinary files.
 *
 * Only the type field is tested, never the whole mode. Zip writers disagree on
 * what they record there: the `zip` CLI and `archiver` store a full
 * `0o100644`, while Python's `zipfile.writestr` stores bare permission bits
 * such as `0o600` with no type field at all. Both describe a regular file, so
 * both must extract. Testing the whole mode instead once rejected every entry a
 * permission-only writer produced, which emptied the archive and failed the run
 * with an unrelated ECS circuit-breaker message.
 *
 * A non-zero type field that is not S_IFREG is a symlink, device, FIFO, or
 * socket, and stays rejected.
 */
function isRegularFile(entry: Entry): boolean {
  const ifmt = fileType(entry);
  return ifmt === 0 || ifmt === S_IFREG;
}

// Resolves an entry name under destDir and rejects anything that escapes it.
//
// Defense in depth, and deliberately kept even though nothing reaches the throw
// today: yauzl validates entry names first while decodeStrings is on (its default,
// which openZip relies on), rejecting a "../" component as "invalid relative path"
// and a leading "/" as "absolute path" before an entry is ever emitted. This check
// is what holds if that validation is ever relaxed or bypassed.
function safeTarget(destDir: string, entryName: string): string {
  const target = resolve(destDir, entryName);
  const rel = relative(destDir, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Zip entry "${entryName}" resolves outside the destination directory.`);
  }
  return target;
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolveZip, rejectZip) => {
    open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipfile) => {
      if (error || !zipfile) {
        rejectZip(error ?? new Error(`Unable to open zip "${zipPath}".`));
      } else {
        resolveZip(zipfile);
      }
    });
  });
}

function openEntryStream(zipfile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolveStream, rejectStream) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        rejectStream(error ?? new Error(`Unable to read zip entry "${entry.fileName}".`));
      } else {
        resolveStream(stream);
      }
    });
  });
}

/** What extractZip did with one entry, accumulated into the summary. */
type EntryOutcome =
  | { readonly kind: "file" }
  | { readonly kind: "directory" }
  | { readonly kind: "skipped"; readonly mode: number };

async function writeEntry(zipfile: ZipFile, destDir: string, entry: Entry): Promise<EntryOutcome> {
  // yauzl marks directory entries with a trailing slash.
  const isDirectory = entry.fileName.endsWith("/");
  const target = safeTarget(destDir, entry.fileName);

  if (isDirectory) {
    await mkdir(target, { recursive: true });
    return { kind: "directory" };
  }

  // Never recreate symlinks (the GHSA-jmr9-qjv8-65gv vector) or other special
  // file types such as devices or FIFOs. Skipping is safe for the archives this
  // solution extracts, which hold only regular files and directories. The
  // isSymlink check is redundant with isRegularFile and kept so the guard against
  // the advisory stays visible at the point it applies.
  if (isSymlink(entry) || !isRegularFile(entry)) {
    return { kind: "skipped", mode: unixMode(entry) };
  }

  await mkdir(dirname(target), { recursive: true });
  const readStream = await openEntryStream(zipfile, entry);
  await pipeline(readStream, createWriteStream(target));
  return { kind: "file" };
}

/** One entry extractZip declined to write, named so a caller can report it. */
export interface SkippedZipEntry {
  /**
   * The entry name, already shaped by {@link safeEntryName} for safe logging, so
   * a caller may use it without sanitizing again. Not a usable path.
   */
  readonly name: string;
  /** The entry's unix mode as it reads in source, e.g. 0o120777 for a symlink. */
  readonly mode: string;
}

/**
 * What an extraction produced. Callers use it to explain an archive that yielded
 * nothing usable, which is otherwise indistinguishable from an empty zip.
 */
export interface ExtractZipSummary {
  readonly filesWritten: number;
  readonly directoriesCreated: number;
  /** Every entry skipped as non-regular, however many there were. */
  readonly skippedCount: number;
  /** The first {@link MAX_REPORTED_SKIPS} skipped entries, for diagnostics. */
  readonly skippedEntries: readonly SkippedZipEntry[];
}

/**
 * Extracts every regular file and directory in the zip at `zipPath` into
 * `destDir`, creating `destDir` if needed. Symlink and other non-regular entries
 * are skipped, and any entry whose path escapes `destDir` is rejected.
 *
 * @returns A count of what was written and which entries were skipped.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<ExtractZipSummary> {
  const root = resolve(destDir);
  await mkdir(root, { recursive: true });

  let filesWritten = 0;
  let directoriesCreated = 0;
  let skippedCount = 0;
  // Bounded: the entry count comes from an uploaded archive, so only the first
  // few skips are retained while skippedCount keeps the true total.
  const skippedEntries: SkippedZipEntry[] = [];

  const zipfile = await openZip(zipPath);
  try {
    await new Promise<void>((resolveAll, rejectAll) => {
      zipfile.on("error", rejectAll);
      zipfile.on("end", resolveAll);
      zipfile.on("entry", (entry: Entry) => {
        // Process one entry at a time (lazyEntries), advancing only after the
        // current entry is fully written so writes never run unbounded.
        writeEntry(zipfile, root, entry).then((outcome) => {
          if (outcome.kind === "file") {
            filesWritten += 1;
          } else if (outcome.kind === "directory") {
            directoriesCreated += 1;
          } else {
            skippedCount += 1;
            if (skippedEntries.length < MAX_REPORTED_SKIPS) {
              skippedEntries.push({ name: safeEntryName(entry.fileName), mode: formatMode(outcome.mode) });
            }
          }
          zipfile.readEntry();
        }, rejectAll);
      });
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }

  return { filesWritten, directoriesCreated, skippedCount, skippedEntries };
}
