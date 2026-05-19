// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import archiver from "archiver";
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
  for (const file of files) {
    const localPath = join(outputDir, file.relativePath);
    const dir = dirname(localPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.key }));

    if (!resp.Body) {
      console.error(`  Warning: empty body for ${file.key}, skipping.`);
      continue;
    }

    const body = resp.Body as Readable;
    const ws = createWriteStream(localPath);
    await pipeline(body, ws);
    console.error(`  ✓ ${file.relativePath} (${formatBytes(file.size)})`);
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
  const archive = archiver("zip", { zlib: { level: 6 } });

  const archiveFinished = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);

  for (const file of files) {
    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.key }));

    if (!resp.Body) {
      console.error(`  Warning: empty body for ${file.key}, skipping.`);
      continue;
    }

    archive.append(resp.Body as Readable, { name: file.relativePath });
    console.error(`  ✓ ${file.relativePath} (${formatBytes(file.size)})`);
  }

  await archive.finalize();
  await archiveFinished;
}

/**
 * Filter files by a simple glob pattern (supports * wildcards).
 */
export function filterFiles(files: ArtifactFile[], pattern: string): ArtifactFile[] {
  // Convert simple glob to regex: *.xml → .*\.xml$
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return files.filter((f) => regex.test(f.relativePath));
}

/**
 * Build the S3 prefix for a test run's artifacts.
 * S3 folders are named: {startTime}_{testRunId}
 * where startTime has colons replaced with hyphens and spaces with T.
 */
export function buildArtifactPrefix(testId: string, startTime: string, testRunId: string): string {
  const normalized = startTime.replace(/ /g, "T").replace(/:/g, "-");
  return `results/${testId}/${normalized}_${testRunId}`;
}

/**
 * Find the actual S3 prefix for a test run by listing prefixes and matching
 * on the testRunId suffix. Handles timestamp discrepancies between API and S3.
 */
export async function resolveArtifactPrefix(
  bucket: string,
  testId: string,
  startTime: string,
  testRunId: string,
  region: string,
  credentials: AwsCredentialIdentity,
  s3: S3Client = createS3Client(region, credentials)
): Promise<string | null> {
  // First try the exact prefix
  const exactPrefix = buildArtifactPrefix(testId, startTime, testRunId);
  const exactCheck = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: exactPrefix + "/",
      MaxKeys: 1,
    })
  );
  if (exactCheck.Contents && exactCheck.Contents.length > 0) {
    return exactPrefix;
  }

  // Exact prefix didn't match — search for a folder ending with _{testRunId}
  const searchPrefix = `results/${testId}/`;
  const listResp = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: searchPrefix,
      Delimiter: "/",
    })
  );

  const suffix = `_${testRunId}/`;
  const match = (listResp.CommonPrefixes ?? []).find((p) => p.Prefix?.endsWith(suffix));

  if (match?.Prefix) {
    // Remove trailing slash
    return match.Prefix.slice(0, -1);
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
      const resolved = await resolveArtifactPrefix(
        config.scenariosBucket,
        testId,
        runData.startTime,
        runData.testRunId,
        config.region,
        s3Creds
      );
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

  // Resolve actual S3 prefix (handles timestamp discrepancies)
  const prefix = await resolveArtifactPrefix(
    config.scenariosBucket,
    testId,
    runData.startTime,
    runData.testRunId,
    config.region,
    s3Creds,
    s3
  );

  if (!prefix) {
    console.error("No artifact folder found for this test run in S3.");
    return;
  }

  console.error(`Listing artifacts in s3://${config.scenariosBucket}/${prefix}/`);
  let files = await listArtifacts(config.scenariosBucket, prefix, config.region, s3Creds, s3);

  if (files.length === 0) {
    console.error("No artifacts found for this test run.");
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
    for (const f of files) {
      console.log(`${f.relativePath}  (${formatBytes(f.size)})`);
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
