// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Test-artifact pipeline for the DevOps Agent integration.
 *
 * Responsibilities:
 * 1. Locate a test run's result objects in S3 (paginated, precise prefix).
 * 2. Curate the highest-signal files (.err/.out/.log) into a single attachment.
 * 3. Scrub credentials/secrets before forwarding to the agent.
 * 4. Upload the attachment as an agent-space asset, and delete assets on cleanup.
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");

const utils = require("solution-utils");
const { createAsset, deleteAsset } = require("../integrations/aidevops");

const options = utils.getOptions({ region: process.env.AWS_REGION });
const s3 = new S3Client(options);

const { SCENARIOS_BUCKET } = process.env;

/**
 * Shared sensitive-data denylist. Keeps credentials and secrets out of anything
 * forwarded to the DevOps Agent: the operator-supplied context, the generated
 * investigation description, and uploaded test artifacts.
 */
const DENYLIST_PATTERNS = [
  /AKIA[0-9A-Z]{16}/i,
  /ASIA[0-9A-Z]{16}/i,
  /aws_secret_access_key/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /password\s*[=:]\s*\S+/i,
];

/**
 * Returns true when the text matches any denylist pattern (AWS access key
 * prefixes, secret-key references, JWT-shaped tokens, or password assignments).
 * @param {string} [text]
 * @returns {boolean}
 */
const containsSensitiveData = (text) => {
  if (!text) return false;
  return DENYLIST_PATTERNS.some((pattern) => pattern.test(text));
};

/** File extensions to upload, in priority order (.err first — highest signal). */
const ARTIFACT_EXTENSIONS = [".err", ".out", ".log"];
/** Max size per individual artifact file. */
const MAX_ARTIFACT_SIZE = 512 * 1024;
/** Max artifacts to include. */
const MAX_ARTIFACT_COUNT = 10;
/** CreateAsset text body limit from API docs (1,572,864 bytes). Leave margin for JSON envelope. */
const MAX_ASSET_TEXT_SIZE = 1_550_000;

/**
 * Returns the file extension of an S3 key, derived from the basename only.
 * Returns "" when the basename has no dot, so a dotless key (or a dot in a
 * parent folder name) is never misread as an extension.
 */
const extensionOf = (key) => {
  const base = key.substring(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.substring(dot) : "";
};

/**
 * Lists S3 objects under a prefix, following continuation tokens so results are
 * never silently truncated by a page-size cap. When `delimiter` is set, also
 * returns the CommonPrefixes (sub-"folders") for that level.
 *
 * @returns {Promise<{objects: object[], commonPrefixes: string[]}>}
 */
const listAllObjects = async (prefix, { delimiter } = {}) => {
  const objects = [];
  const commonPrefixes = [];
  let continuationToken;

  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: SCENARIOS_BUCKET,
      Prefix: prefix,
      ...(delimiter && { Delimiter: delimiter }),
      ...(continuationToken && { ContinuationToken: continuationToken }),
    }));
    objects.push(...(resp.Contents || []));
    commonPrefixes.push(...(resp.CommonPrefixes || []).map((p) => p.Prefix));
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return { objects, commonPrefixes };
};

/**
 * Resolves the exact S3 prefix for a test run's result folder.
 * Result folders are laid out as results/{testId}/{timestamp}_{testRunId}/, so
 * a delimiter scan of the testId level pinpoints the run folder without relying
 * on a fragile substring match. Returns null when the folder can't be found.
 */
const resolveRunPrefix = async (testId, testRunId) => {
  const { commonPrefixes } = await listAllObjects(`results/${testId}/`, { delimiter: "/" });
  return commonPrefixes.find((p) => p.endsWith(`_${testRunId}/`)) ?? null;
};

/**
 * Uploads test result artifacts (.err, .out, .log) to the DevOps Agent Space
 * as a single concatenated text attachment. Best-effort — failures do not block
 * investigation creation.
 *
 * @returns {Promise<{assetId: string, fileCount: number}|null>}
 */
const uploadTestArtifacts = async ({ testId, testRunId, agentSpaceId, region, correlationId, requesterCognitoSub }) => {
  try {
    // 1. Locate the run's result objects. Prefer the exact run folder
    //    (results/{testId}/{timestamp}_{testRunId}/); fall back to a filtered,
    //    fully-paginated listing of the testId tree if the folder isn't found.
    const runPrefix = await resolveRunPrefix(testId, testRunId);
    const { objects } = runPrefix
      ? await listAllObjects(runPrefix)
      : await listAllObjects(`results/${testId}/`);

    const candidates = objects
      .filter((obj) => {
        const key = obj.Key || "";
        // In the fallback path, restrict to this run's folder boundary so a
        // testRunId that is a substring of another key can't leak in.
        if (!runPrefix && !key.includes(`_${testRunId}/`)) return false;
        const ext = extensionOf(key);
        return ARTIFACT_EXTENSIONS.includes(ext) && obj.Size > 0 && obj.Size <= MAX_ARTIFACT_SIZE;
      })
      .sort((a, b) => {
        const byPriority = ARTIFACT_EXTENSIONS.indexOf(extensionOf(a.Key)) - ARTIFACT_EXTENSIONS.indexOf(extensionOf(b.Key));
        return byPriority !== 0 ? byPriority : a.Key.localeCompare(b.Key);
      })
      .slice(0, MAX_ARTIFACT_COUNT);

    if (candidates.length === 0) {
      console.log(JSON.stringify({ level: "info", action: "artifacts.skipped", testId, testRunId, reason: "no matching .err/.out/.log files found" }));
      return null;
    }

    // 2. Download all files in parallel
    const results = await Promise.allSettled(
      candidates.map(async (obj) => {
        const response = await s3.send(new GetObjectCommand({ Bucket: SCENARIOS_BUCKET, Key: obj.Key }));
        const text = await response.Body.transformToString("utf-8");
        return { key: obj.Key, size: obj.Size, text };
      }),
    );
    const files = results.filter((r) => r.status === "fulfilled").map((r) => r.value);

    if (files.length === 0) return null;

    // 3. Concatenate into a single text document, respecting the size limit.
    //    Build into an array with a running byte count and join once to avoid
    //    re-measuring the whole accumulator on every iteration.
    const sections = [];
    let runningBytes = 0;
    for (const file of files) {
      const fileName = file.key.split("/").pop();
      const section = `${"=".repeat(80)}\n== FILE: ${fileName} (${file.size} bytes)\n${"=".repeat(80)}\n${file.text}\n\n`;
      const sectionBytes = Buffer.byteLength(section, "utf-8");
      if (runningBytes + sectionBytes > MAX_ASSET_TEXT_SIZE) break;
      sections.push(section);
      runningBytes += sectionBytes;
    }

    if (sections.length === 0) return null;

    const combinedContent = sections.join("");

    // 3a. Never forward content that resembles credentials or secrets. The
    //     artifacts are the target's own output, so they bypass the description
    //     denylist; scan them here and skip the upload (non-blocking) on a match.
    if (containsSensitiveData(combinedContent)) {
      console.log(JSON.stringify({ level: "warn", action: "artifacts.skipped", testId, testRunId, reason: "artifact content matched sensitive-data denylist" }));
      return null;
    }

    const contentBytes = Buffer.byteLength(combinedContent, "utf-8");

    // 4. Upload as a single attachment asset
    const asset = await createAsset({
      agentSpaceId,
      assetType: "attachment",
      metadata: {
        filename: `dlt-artifacts-${testId}-${testRunId}.txt`,
        extension: "txt",
        size: contentBytes,
        testId,
        testRunId,
        source: "distributed-load-testing",
        description: "Test execution artifacts from a DLT load test. Contains .err (error output), .out (stdout), and .log (execution log) files. Read .err sections first for failure details.",
      },
      content: {
        file: {
          path: `dlt-artifacts-${testRunId}.txt`,
          body: { text: combinedContent },
        },
      },
      region,
      correlationId,
      requesterCognitoSub,
    });

    console.log(JSON.stringify({ level: "info", action: "artifacts.uploaded", assetId: asset.assetId, fileCount: sections.length, sizeBytes: contentBytes, testId, testRunId }));
    return { assetId: asset.assetId, fileCount: sections.length };
  } catch (err) {
    console.log(JSON.stringify({ level: "error", action: "artifacts.failed", error: err.message, testId, testRunId }));
    return null;
  }
};

/**
 * Best-effort deletion of an artifact asset. Never throws — used both to
 * compensate for a failed investigation creation (so the asset is not orphaned)
 * and to clean up on archive/cancel. A failure here is logged and swallowed.
 */
const deleteArtifactAsset = async ({ agentSpaceId, assetId, region, correlationId, requesterCognitoSub, reason }) => {
  if (!agentSpaceId || !assetId) return;
  try {
    await deleteAsset({ agentSpaceId, assetId, region, correlationId, requesterCognitoSub });
    console.log(JSON.stringify({ level: "info", action: "artifacts.deleted", assetId, reason }));
  } catch (err) {
    console.log(JSON.stringify({ level: "error", action: "artifacts.deleteFailed", assetId, reason, error: err.message }));
  }
};

/**
 * Best-effort cleanup of the artifact asset associated with an investigation
 * record, invoked when the investigation is archived or canceled so artifacts do
 * not accumulate in the agent space. No-ops when the record has no asset.
 */
const cleanupInvestigationAsset = async (investigation, correlationId, requesterCognitoSub, reason) => {
  await deleteArtifactAsset({
    agentSpaceId: investigation.agentSpaceApiId,
    assetId: investigation.artifactAssetId,
    region: investigation.agentSpaceRegion,
    correlationId,
    requesterCognitoSub,
    reason,
  });
};

module.exports = {
  uploadTestArtifacts,
  deleteArtifactAsset,
  cleanupInvestigationAsset,
  containsSensitiveData,
  // Exported for unit tests
  extensionOf,
  resolveRunPrefix,
  ARTIFACT_EXTENSIONS,
  MAX_ARTIFACT_SIZE,
  MAX_ARTIFACT_COUNT,
  MAX_ASSET_TEXT_SIZE,
};
