// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createWriteStream, mkdirSync, realpathSync, lstatSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { ZipArchive } from "archiver";
import { entryNameFor, isControlChar } from "@amzn/dlt-common";
import { confirmOverwrite } from "./prompt.js";
import type { AwsCredentialIdentity } from "./http-client.js";
import type { ApiClient } from "./api-client.js";
import type { TestRun } from "./types.js";

export interface ArtifactFile {
  key: string;
  /** Key relative to the results prefix (the part after results/{testId}/{startTime}/) */
  relativePath: string;
  size: number;
}

/**
 * List all artifact files for a test run in S3.
 */
export async function listArtifacts(
  bucket: string,
  prefix: string,
  region: string,
  credentials: AwsCredentialIdentity,
  client: S3Client = createS3Client(region, credentials)
): Promise<ArtifactFile[]> {
  // Ensure prefix ends with /
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  const files: ArtifactFile[] = [];
  let continuationToken: string | undefined;

  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of resp.Contents ?? []) {
      if (!obj.Key || obj.Size === 0) continue; // skip directory markers

      files.push({
        key: obj.Key,
        relativePath: obj.Key.slice(normalizedPrefix.length),
        size: obj.Size ?? 0,
      });
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return files;
}

/**
 * Resolve a validated `entryName` to an absolute local path beneath `realRoot`, creating its
 * parent directory, or return `null` (with a warning) when a pre-existing symlink would redirect
 * the write outside `realRoot` or the path can't be resolved. Filesystem-layer companion to
 * `entryNameFor`: `resolve()` is lexical and doesn't follow links. `displayName` is the
 * already-sanitized name used in warnings.
 */
function resolveSafeWritePath(outputDir: string, realRoot: string, entryName: string, displayName: string): string | null {
  const localPath = resolve(outputDir, entryName);
  const dir = dirname(localPath);
  let realDir: string;
  try {
    mkdirSync(dir, { recursive: true });
    realDir = realpathSync(dir);
  } catch {
    console.error(`  Warning: skipping ${displayName} — could not resolve a safe output path.`);
    return null;
  }
  if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
    console.error(`  Warning: skipping ${displayName} — resolves outside the output directory via a symlink.`);
    return null;
  }
  try {
    if (lstatSync(localPath).isSymbolicLink()) {
      console.error(`  Warning: skipping ${displayName} — target is a symlink.`);
      return null;
    }
  } catch {
    // Target does not exist yet — the normal case.
  }
  return localPath;
}

/**
 * Download artifacts to a local directory.
 */
export async function downloadArtifactsToDir(
  bucket: string,
  files: ArtifactFile[],
  outputDir: string,
  region: string,
  credentials: AwsCredentialIdentity,
  client: S3Client = createS3Client(region, credentials)
): Promise<void> {
  // Canonical output root; the symlink guard below asserts every write stays beneath it.
  mkdirSync(resolve(outputDir), { recursive: true });
  const realRoot = realpathSync(resolve(outputDir));

  for (const file of files) {
    // Validate the (attacker-influenced) S3 key suffix rather than trusting it:
    // `entryNameFor` returns the name only if every segment is safe and `null`
    // otherwise, rejecting any `..`, absolute, drive, or UNC form so none can escape.
    const entryName = entryNameFor(file.relativePath);
    if (entryName === null) {
      console.error(`  Warning: skipping ${stripControlChars(file.relativePath)} — no safe entry name.`);
      continue;
    }
    // Resolve to a safe local path (filesystem symlink guard); skip on any rejection.
    const localPath = resolveSafeWritePath(outputDir, realRoot, entryName, stripControlChars(file.relativePath));
    if (localPath === null) continue;

    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.key }));

    if (!resp.Body) {
      console.error(`  Warning: empty body for ${file.key}, skipping.`);
      continue;
    }

    const body = resp.Body as Readable;
    const ws = createWriteStream(localPath);
    await pipeline(body, ws);
    const label = stripControlChars(entryName === file.relativePath ? entryName : `${file.relativePath} → ${entryName}`);
    console.error(`  ✓ ${label} (${formatBytes(file.size)})`);
  }
}

/**
 * Download artifacts into a .zip file.
 */
export async function downloadArtifactsToZip(
  bucket: string,
  files: ArtifactFile[],
  zipPath: string,
  region: string,
  credentials: AwsCredentialIdentity,
  client: S3Client = createS3Client(region, credentials)
): Promise<void> {
  const output = createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 6 } });

  const archiveFinished = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);

  for (const file of files) {
    // Validate the (attacker-influenced) S3 key suffix so the archive can't zip-slip
    // on extraction. `entryNameFor` returns the name only if safe and `null` otherwise,
    // rejecting any `..`, absolute, drive, or UNC form.
    const entryName = entryNameFor(file.relativePath);
    if (entryName === null) {
      console.error(`  Warning: skipping ${stripControlChars(file.relativePath)} — no safe entry name.`);
      continue;
    }

    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.key }));

    if (!resp.Body) {
      console.error(`  Warning: empty body for ${file.key}, skipping.`);
      continue;
    }

    archive.append(resp.Body as Readable, { name: entryName });
    const label = stripControlChars(entryName === file.relativePath ? entryName : `${file.relativePath} → ${entryName}`);
    console.error(`  ✓ ${label} (${formatBytes(file.size)})`);
  }

  await archive.finalize();
  await archiveFinished;
}

/**
 * Filter files by a simple glob pattern (supports * wildcards).
 */
export function filterFiles(files: ArtifactFile[], pattern: string): ArtifactFile[] {
  // Convert simple glob to regex: *.xml → .*\.xml$
  const escaped = pattern.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return files.filter((f) => regex.test(f.relativePath));
}

/**
 * Build the S3 prefix for a test run's artifacts.
 * S3 folders are named: {startTime}_{testRunId}
 * where startTime has colons replaced with hyphens and spaces with T.
 *
 * This is a best-effort guess used only for display when no matching folder can
 * be found in S3; it is not used to locate artifacts (the actual folder
 * timestamp is generated independently of the stored startTime and can differ,
 * so {@link collectRunArtifacts} matches on the `_{testRunId}/` marker instead).
 */
export function buildArtifactPrefix(testId: string, startTime: string, testRunId: string): string {
  const normalized = startTime.replaceAll(" ", "T").replaceAll(":", "-");
  return `results/${testId}/${normalized}_${testRunId}`;
}

/** The run-folder marker embedded in a modern-layout artifact key. */
function runFolderMarker(testRunId: string): string {
  return `_${testRunId}/`;
}

/** Matches an ISO-8601 timestamp embedded in a legacy artifact key/filename. */
const LEGACY_TIMESTAMP_REGEX = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)/;

/** Window (ms) applied to a legacy match when the run has no usable endTime. */
const LEGACY_WINDOW_MS = 90_000;

/**
 * Select legacy-layout artifacts — files stored flat under `results/{testId}/`
 * with an ISO timestamp in the key (the pre-run-folder layout) — whose embedded
 * timestamp falls within the run's `[startTime, endTime]` window. When `endTime`
 * is missing or unparseable, a {@link LEGACY_WINDOW_MS} window from `startTime`
 * is used. Mirrors the web console's fallback so both clients surface the same
 * files for old runs.
 */
function filterLegacyByTimeWindow(
  files: ArtifactFile[],
  startTime: string,
  endTime: string | undefined
): ArtifactFile[] {
  const runStart = new Date(startTime).getTime();
  if (Number.isNaN(runStart)) return [];
  const parsedEnd = new Date(endTime ?? "").getTime();
  const runEnd = Number.isNaN(parsedEnd) ? runStart + LEGACY_WINDOW_MS : parsedEnd;
  return files.filter((f) => {
    const match = LEGACY_TIMESTAMP_REGEX.exec(f.key);
    if (!match?.[1]) return false;
    const fileTime = new Date(match[1]).getTime();
    return !Number.isNaN(fileTime) && fileTime >= runStart && fileTime <= runEnd;
  });
}

/**
 * Collect all S3 artifacts belonging to a single test run.
 *
 * Lists every object under `results/{testId}/` (fully paginated via
 * {@link listArtifacts}) and then attributes files to the run the same way the
 * web console does, so both clients find the same artifacts:
 * - Modern layout: files live under a folder segment ending in `_{testRunId}/`.
 *   The returned `relativePath` is the key after that folder (e.g.
 *   `{region}/{taskId}/results.xml`).
 * - Legacy layout: if no modern folder matches, flat files under
 *   `results/{testId}/` whose embedded ISO timestamp falls in the run's time
 *   window are used, with `relativePath` relative to `results/{testId}/`.
 *
 * Matching on the `_{testRunId}/` marker (not a reconstructed timestamp prefix)
 * avoids the seconds-level skew and non-UTC scheduling mismatch between the
 * stored startTime and the S3 folder timestamp, and full pagination means a
 * scenario with more than 1000 run folders still resolves correctly.
 */
export async function collectRunArtifacts(
  bucket: string,
  testId: string,
  runData: Pick<TestRun, "testRunId" | "startTime" | "endTime">,
  region: string,
  credentials: AwsCredentialIdentity,
  s3: S3Client = createS3Client(region, credentials)
): Promise<ArtifactFile[]> {
  const all = await listArtifacts(bucket, `results/${testId}/`, region, credentials, s3);

  const marker = runFolderMarker(runData.testRunId);
  const modern = all.filter((f) => f.key.includes(marker));
  if (modern.length > 0) {
    return modern.map((f) => ({
      key: f.key,
      relativePath: f.key.slice(f.key.indexOf(marker) + marker.length),
      size: f.size,
    }));
  }

  // Legacy flat layout: no per-run folder, match by timestamp window.
  if (runData.startTime) {
    return filterLegacyByTimeWindow(all, runData.startTime, runData.endTime);
  }

  return [];
}

/**
 * Resolve a representative S3 prefix for a run, for display in `runs artifacts`.
 * Returns the modern run folder (`results/{testId}/{...}_{testRunId}`) when it
 * exists, the flat `results/{testId}/` prefix when only legacy files match, or
 * `null` when nothing is found. Fully paginated; matches on the run-folder
 * marker rather than a reconstructed timestamp.
 */
export async function resolveArtifactPrefix(
  bucket: string,
  testId: string,
  runData: Pick<TestRun, "testRunId" | "startTime" | "endTime">,
  region: string,
  credentials: AwsCredentialIdentity,
  s3: S3Client = createS3Client(region, credentials)
): Promise<string | null> {
  const all = await listArtifacts(bucket, `results/${testId}/`, region, credentials, s3);

  const marker = runFolderMarker(runData.testRunId);
  const hit = all.find((f) => f.key.includes(marker));
  if (hit) {
    // The run folder is the key up to (and including) the marker, sans slash.
    return hit.key.slice(0, hit.key.indexOf(marker) + marker.length - 1);
  }

  // Legacy files have no per-run folder; report the flat test prefix. Uses the
  // run's real endTime (same as collectRunArtifacts) so a legacy run longer than
  // the LEGACY_WINDOW_MS fallback is detected consistently across both paths.
  if (runData.startTime && filterLegacyByTimeWindow(all, runData.startTime, runData.endTime).length > 0) {
    return `results/${testId}/`;
  }

  return null;
}

export function createS3Client(region: string, credentials: AwsCredentialIdentity): S3Client {
  return new S3Client({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strip terminal control characters before echoing an untrusted S3 key suffix. Keys are
 * arbitrary bytes, so a crafted `relativePath` (or an `entryNameFor`-accepted name, which
 * still permits non-NUL control chars) could otherwise inject ANSI escapes, cursor moves,
 * or carriage-return overwrites into the operator's terminal — e.g. disguising `evil.sh`
 * as `safe-results.txt` in a `--dry-run` listing (CWE-150). Drops C0 controls (0x00–0x1F),
 * DEL (0x7F), and C1 controls (0x80–0x9F).
 */
export function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((ch) => !isControlChar(ch.codePointAt(0)!))
    .join("");
}

// ---------------------------------------------------------------------------
// High-level orchestration (used by command handlers)
// ---------------------------------------------------------------------------

/** Information about a test run's artifacts in S3. */
export interface ArtifactInfo {
  testId: string;
  runId: string;
  startTime: string | undefined;
  testType: string | undefined;
  artifactPrefix: string;
}

/**
 * Fetch a test run and resolve its S3 artifact prefix.
 *
 * Uses the {@link ApiClient}'s already-resolved config and credentials so the
 * caller does not need to manage authentication independently.
 */
export async function getArtifactInfo(api: ApiClient, testId: string, runId: string): Promise<ArtifactInfo> {
  const runData = await api.get<TestRun>(
    `/scenarios/${encodeURIComponent(testId)}/testruns/${encodeURIComponent(runId)}`
  );

  let artifactPrefix: string;

  if (runData.startTime) {
    const { config, awsCredentialIdentity: s3Creds } = api;
    if (config.scenariosBucket) {
      const resolved = await resolveArtifactPrefix(config.scenariosBucket, testId, runData, config.region, s3Creds);
      artifactPrefix = resolved ?? buildArtifactPrefix(testId, runData.startTime, runData.testRunId);
    } else {
      artifactPrefix = buildArtifactPrefix(testId, runData.startTime, runData.testRunId);
    }
  } else {
    artifactPrefix = "(unable to determine — missing startTime)";
  }

  return {
    testId,
    runId,
    startTime: runData.startTime,
    testType: runData.testType,
    artifactPrefix,
  };
}

/** Options accepted by {@link downloadRunArtifacts}. */
export interface DownloadRunArtifactsOptions {
  outputDir?: string | undefined;
  zip?: boolean | undefined;
  filter?: string | undefined;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
}

/**
 * Download test-run artifacts from S3.
 *
 * Handles the full workflow: fetch the run, resolve the S3 prefix, list /
 * filter files, and download (to directory or zip).  Uses the
 * {@link ApiClient}'s already-resolved config and credentials.
 */
export async function downloadRunArtifacts(
  api: ApiClient,
  testId: string,
  runId: string,
  options: DownloadRunArtifactsOptions
): Promise<void> {
  const { config, awsCredentialIdentity: s3Creds } = api;

  if (!config.scenariosBucket) {
    throw new Error(
      'Scenarios bucket not configured. Run "dlt configure --from-file aws-exports.json" ' +
        'or "dlt configure --scenarios-bucket <bucket-name>" to set it.'
    );
  }

  // Fetch the test run to find startTime
  const runData = await api.get<TestRun>(
    `/scenarios/${encodeURIComponent(testId)}/testruns/${encodeURIComponent(runId)}`
  );

  if (!runData.startTime) {
    throw new Error("Test run has no startTime — cannot determine artifact location.");
  }

  const s3 = createS3Client(config.region, s3Creds);

  // Collect the run's artifacts (modern _{testRunId}/ folder, or legacy flat
  // layout), matching how the web console attributes files — fully paginated.
  console.error(`Searching for artifacts under s3://${config.scenariosBucket}/results/${testId}/`);
  let files = await collectRunArtifacts(config.scenariosBucket, testId, runData, config.region, s3Creds, s3);

  if (files.length === 0) {
    console.error("No artifacts found for this test run in S3.");
    return;
  }

  // Apply filter
  if (options.filter) {
    files = filterFiles(files, options.filter);
    if (files.length === 0) {
      console.error(`No artifacts match the filter "${options.filter}".`);
      return;
    }
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  console.error(`Found ${files.length} file(s), ${formatBytes(totalSize)} total.`);

  // Dry-run: just list files
  if (options.dryRun) {
    // Preview the real outcome: apply the same name gate as the download so the operator
    // sees ahead of time which entries would be skipped and why. (Filesystem-time checks —
    // symlink resolution — can't be previewed without touching disk, so they still run at
    // download time.) Skips go to stderr so stdout stays the clean list of what will download.
    for (const f of files) {
      const entryName = entryNameFor(f.relativePath);
      if (entryName === null) {
        console.error(`  Warning: would skip ${stripControlChars(f.relativePath)} — no safe entry name.`);
        continue;
      }
      console.log(`${stripControlChars(entryName)}  (${formatBytes(f.size)})`);
    }
    return;
  }

  // Download
  const force = !!options.force;
  if (options.zip) {
    const zipName = options.outputDir ?? `${testId}-${runId}.zip`;
    await confirmOverwrite(zipName, force);
    console.error(`Downloading to ${zipName}`);
    await downloadArtifactsToZip(config.scenariosBucket, files, zipName, config.region, s3Creds, s3);
    console.error(`\nDone. Saved to ${zipName}`);
  } else {
    const dir = options.outputDir ?? `${testId}-${runId}`;
    await confirmOverwrite(dir, force);
    console.error(`Downloading to ${dir}/`);
    await downloadArtifactsToDir(config.scenariosBucket, files, dir, config.region, s3Creds, s3);
    console.error(`\nDone. ${files.length} file(s) saved to ${dir}/`);
  }
}
