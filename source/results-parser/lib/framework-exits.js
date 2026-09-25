// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { frameworkExitReportKey } = require("@amzn/dlt-common/s3-keys");

/**
 * Aggregate per-task reporting for native framework exits.
 *
 * When a load test framework exits with a non-zero exit code, that
 * task writes one framework-exit.json object alongside its results.
 * These files capture the exit code, message, and task metadata.
 *
 * This module turns per-task files into the two views customers actually see:
 *
 *   - framework-exits.jsonl in S3, holding every valid record for the run;
 *   - a bounded top-three summary stored on the run-history item for the console.
 *
 * These exit codes may indicate true failures or simple indications that a test
 * result does not meet desired thresholds or assertions (e.g. failed http requests
 * or latency greater than a user-defined threshold).
 */

// Read fifty small exit files at a time.
const BATCH_SIZE = 50;

// The console shows the three most common exits.
const TOP_COMBINATION_COUNT = 3;

// Keep each summary message small to store alongside rest of the history object
// in the History DDB table. The complete message stays in S3.
const MAX_MESSAGE_BYTES = 2 * 1024;

/**
 * Read one exit file. Throwing here skips only this file, not the whole report.
 */
async function readFrameworkExit(s3, bucket, key) {
  const content = await s3.getObject({ Bucket: bucket, Key: key });
  const record = JSON.parse(await content.Body.transformToString());
  if (typeof record?.message !== "string" || !Number.isFinite(record?.exitCode)) {
    throw new TypeError("Framework-exit artifact is not a record.");
  }
  return record;
}

/**
 * Count tasks that reported the same exit code and message.
 */
function countCombination(counts, { framework, exitCode, message }) {
  const tuple = `${exitCode} ${message}`;
  const combination = counts.get(tuple) ?? { framework, exitCode, message, count: 0 };
  combination.count += 1;
  counts.set(tuple, combination);
}

/**
 * Shorten a summary message to 2 KiB without cutting a character in half.
 */
function clampMessage(combination) {
  if (Buffer.byteLength(combination.message, "utf8") <= MAX_MESSAGE_BYTES) return combination;

  let bytes = 0;
  let message = "";
  for (const character of combination.message) {
    bytes += Buffer.byteLength(character, "utf8");
    if (bytes > MAX_MESSAGE_BYTES) break;
    message += character;
  }
  return { ...combination, message };
}

/**
 * Pick the three most common exits. Use exit code and message to break ties.
 */
const topCombinations = (counts) =>
  Array.from(counts.values())
    .sort(
      (left, right) =>
        right.count - left.count || left.exitCode - right.exitCode || left.message.localeCompare(right.message)
    )
    .slice(0, TOP_COMBINATION_COUNT);

/**
 * Build the small summary stored with the test run.
 */
const buildSummary = (counts, totalCount, artifactKey) => ({
  totalCount,
  artifactKey,
  top: topCombinations(counts).map(clampMessage),
});

/**
 * Build the run's framework-exit report.
 *
 * S3 file list -> matching exit files -> JSONL report -> top-three summary
 *
 * Bad files are counted and skipped. If there are no exit files, return nothing.
 *
 * @param {object} params
 * @param {object} params.s3 S3 client.
 * @param {string} params.bucket Bucket containing the files.
 * @param {object[]} params.resultList Files found for the run.
 * @param {string} params.testId Test ID.
 * @param {string} params.prefix Run folder.
 * @return {Promise<object|undefined>} Report details and operational statistics.
 */
async function writeFrameworkExitsReport({ s3, bucket, resultList, testId, prefix }) {
  const runPrefix = `results/${testId}/${prefix}/`;
  // Keep only exit files and sort them so repeated runs produce the same report.
  const keys = resultList
    .map((entry) => entry.Key)
    .filter((key) => typeof key === "string" && key.startsWith(runPrefix) && key.endsWith("/framework-exit.json"))
    .sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) return undefined;

  const lines = [];
  const counts = new Map();
  const exitCodeCounts = new Map();
  // Limit parallel S3 reads because a run can have thousands of tasks.
  for (let offset = 0; offset < keys.length; offset += BATCH_SIZE) {
    const batch = keys.slice(offset, offset + BATCH_SIZE);
    const reads = await Promise.allSettled(batch.map((key) => readFrameworkExit(s3, bucket, key)));

    for (const read of reads) {
      if (read.status === "rejected") {
        // Do not log the error message because it may contain framework output.
        console.error("Skipping framework-exit artifact:", {
          errorName: read.reason?.name,
        });
        continue;
      }
      // Put each object on one line without changing its fields.
      lines.push(JSON.stringify(read.value));
      countCombination(counts, read.value);
      exitCodeCounts.set(read.value.exitCode, (exitCodeCounts.get(read.value.exitCode) ?? 0) + 1);
    }
  }

  const statistics = {
    frameworkExitTaskCount: lines.length,
    exitCodeCounts: Array.from(exitCodeCounts, ([ExitCode, TaskCount]) => ({ ExitCode, TaskCount })).sort(
      (left, right) => left.ExitCode - right.ExitCode
    ),
    invalidExitArtifactCount: keys.length - lines.length,
  };

  // We found exit files, but none were valid enough to include in the report.
  if (lines.length === 0) return { statistics };

  const artifactKey = frameworkExitReportKey(testId, prefix);
  try {
    await s3.putObject({
      Bucket: bucket,
      Key: artifactKey,
      Body: `${lines.join("\n")}\n`,
      ContentType: "application/x-ndjson",
    });
  } catch {
    console.error("Framework-exit report upload failed");
    return { statistics };
  }

  return { summary: buildSummary(counts, lines.length, artifactKey), artifactKey, statistics };
}

module.exports = { writeFrameworkExitsReport };
