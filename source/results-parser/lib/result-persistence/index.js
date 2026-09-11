// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require("crypto");

const DEFAULT_MAX_RESULT_LABELS = 100;
const DEFAULT_MAX_DDB_RESULT_BYTES = 300 * 1024;
const MIN_DDB_RESULT_BYTES = 16 * 1024;

const positiveInteger = (value, fallback, minimum = 1) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

const labelCount = (results) =>
  Object.values(results).reduce(
    (count, result) => count + (Array.isArray(result?.labels) ? result.labels.length : 0),
    0
  );

const sortLabels = (labels) =>
  [...labels].sort((left, right) => {
    const throughputDifference = Number(right?.throughput || 0) - Number(left?.throughput || 0);
    if (throughputDifference !== 0) return throughputDifference;
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  });

const compactResults = (results, maxLabelsPerScope) =>
  Object.fromEntries(
    Object.entries(results).map(([scope, result]) => [
      scope,
      Array.isArray(result?.labels)
        ? { ...result, labels: sortLabels(result.labels).slice(0, maxLabelsPerScope) }
        : result,
    ])
  );

const minimalResults = (results) => {
  const scalarKeys = [
    "avg_ct", "avg_lt", "avg_rt", "bytes", "concurrency", "fail",
    "p0_0", "p100_0", "p50_0", "p90_0", "p95_0", "p99_0", "p99_9",
    "stdev_rt", "succ", "testDuration", "throughput",
  ];
  return Object.fromEntries(
    Object.entries(results).slice(0, 32).map(([scope, result]) => [
      scope,
      Object.fromEntries(
        scalarKeys
          .filter((key) => ["string", "number", "boolean"].includes(typeof result?.[key]))
          .map((key) => [key, result[key]])
      ),
    ])
  );
};

const compactToByteLimit = (results, maxLabelsPerScope, maxBytes) => {
  let labelLimit = maxLabelsPerScope;
  let compacted = compactResults(results, labelLimit);
  let byteLength = Buffer.byteLength(JSON.stringify(compacted));

  while (byteLength > maxBytes && labelLimit > 0) {
    labelLimit = Math.floor(labelLimit / 2);
    compacted = compactResults(results, labelLimit);
    byteLength = Buffer.byteLength(JSON.stringify(compacted));
  }

  if (byteLength > maxBytes) {
    labelLimit = 0;
    compacted = minimalResults(results);
    byteLength = Buffer.byteLength(JSON.stringify(compacted));
  }

  return { results: compacted, byteLength, labelLimit };
};

async function prepareResultsForPersistence({
  s3,
  bucket,
  testId,
  testRunId,
  rawResultsPrefix,
  results,
  env = process.env,
}) {
  const maxLabelsPerScope = positiveInteger(
    env.RESULTS_MAX_LABELS_PER_SCOPE,
    DEFAULT_MAX_RESULT_LABELS
  );
  const maxDdbResultBytes = positiveInteger(
    env.RESULTS_MAX_DDB_BYTES,
    DEFAULT_MAX_DDB_RESULT_BYTES,
    MIN_DDB_RESULT_BYTES
  );
  const serialized = JSON.stringify(results);
  const originalByteLength = Buffer.byteLength(serialized);
  const originalLabelCount = labelCount(results);
  const exceedsCardinality = Object.values(results).some(
    (result) => Array.isArray(result?.labels) && result.labels.length > maxLabelsPerScope
  );

  if (!exceedsCardinality && originalByteLength <= maxDdbResultBytes) {
    return {
      results,
      summaryState: {
        status: "complete",
        byteLength: originalByteLength,
        labelCount: originalLabelCount,
      },
    };
  }

  const compacted = compactToByteLimit(results, maxLabelsPerScope, maxDdbResultBytes);
  const persistedLabelCount = labelCount(compacted.results);
  const checksum = createHash("sha256").update(serialized).digest();
  const key = `result-summaries/${testId}/${testRunId}/summary.json`;
  let fullSummary;

  try {
    const response = await s3.putObject({
      Bucket: bucket,
      Key: key,
      Body: serialized,
      ContentType: "application/json",
      ChecksumSHA256: checksum.toString("base64"),
      Metadata: {
        "test-id": testId,
        "test-run-id": testRunId,
        "raw-results-prefix": rawResultsPrefix,
        "sha256": checksum.toString("hex"),
      },
    });
    fullSummary = {
      bucket,
      key,
      versionId: response.VersionId || null,
      eTag: response.ETag || null,
      sha256: checksum.toString("hex"),
    };
  } catch (error) {
    console.error(
      `Failed to store oversized result summary for testId=${testId}, testRunId=${testRunId}: ${error.message}`
    );
    fullSummary = {
      status: "upload failed",
      errorName: error.name || "Error",
    };
  }

  return {
    results: compacted.results,
    summaryState: {
      status: "summary truncated",
      reason: exceedsCardinality ? "label cardinality or size exceeded" : "size exceeded",
      originalByteLength,
      persistedByteLength: compacted.byteLength,
      originalLabelCount,
      persistedLabelCount,
      omittedLabelCount: originalLabelCount - persistedLabelCount,
      maxLabelsPerScope: compacted.labelLimit,
      maxDdbResultBytes,
      fullSummary,
      rawArtifacts: {
        bucket,
        prefix: rawResultsPrefix,
      },
    },
  };
}

module.exports = {
  DEFAULT_MAX_RESULT_LABELS,
  DEFAULT_MAX_DDB_RESULT_BYTES,
  compactResults,
  prepareResultsForPersistence,
};
