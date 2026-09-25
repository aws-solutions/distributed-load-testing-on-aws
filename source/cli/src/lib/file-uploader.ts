// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, statSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { S3Client, PutObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { fileTypeForAssetFilename, getTestAssetCandidates, isLoadTestFramework, testScriptKey } from "@amzn/dlt-common";
import type { LoadTestFramework } from "@amzn/dlt-common";
import type { ApiClient } from "./api-client.js";

/**
 * The lowercased file extension without the leading dot (e.g. `"jmx"`), or an
 * empty string when the path has no extension. Uses `path.extname` so a
 * dot-containing directory or a dotless filename is handled correctly, unlike a
 * naive `split(".").pop()`.
 * @param filePath The file path or name to inspect.
 */
export function fileExtension(filePath: string): string {
  return extname(filePath).slice(1).toLowerCase();
}

/**
 * Reject a script file whose extension doesn't match its framework before any
 * upload — e.g. a `.py` file for a `k6` test, which would upload fine but fail
 * at run time. The allowed extensions come from the shared asset-key contract,
 * so this stays in sync with what the task runner actually looks for. A `.zip`
 * is always accepted (the container unpacks it). Non-framework test types
 * (`simple`) are not script-driven and are skipped.
 * @param testType The scenario's test type.
 * @param filePath The local script path.
 */
export function assertScriptFileMatchesTestType(testType: string, filePath: string): void {
  if (!isLoadTestFramework(testType)) {
    return;
  }
  const ext = extname(filePath).slice(1).toLowerCase();
  if (ext === "zip") {
    return;
  }
  const allowed = getTestAssetCandidates(testType, "script", "x").map((candidate) => candidate.extension);
  if (!allowed.includes(ext as (typeof allowed)[number])) {
    const allowedList = [...allowed.map((e) => `.${e}`), ".zip"].join(", ");
    const got = ext ? `.${ext}` : "no extension";
    throw new Error(`--file for a ${testType} test must be one of: ${allowedList} (got ${got})`);
  }
}

export interface FileUploadOptions {
  filePath: string;
  testId: string;
  testType: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const CONTENT_TYPES: Record<string, string> = {
  ".jmx": "application/xml",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".py": "text/x-python",
  ".zip": "application/zip",
};

export async function uploadTestFile(
  api: ApiClient,
  options: FileUploadOptions,
  s3?: S3Client
): Promise<{ key: string; fileType: "script" | "zip" }> {
  const { filePath, testId, testType } = options;
  const { config, awsCredentialIdentity: credentials } = api;

  if (!config.scenariosBucket) {
    throw new Error("Error: Scenarios bucket not configured. Run `dlt configure` with --scenarios-bucket");
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error("Error: File exceeds 50MB limit");
  }

  const ext = extname(filePath).toLowerCase();
  const fileType = fileTypeForAssetFilename(filePath);
  // Use the shared cross-service key builder so the CLI writes the script to the
  // exact location the task runner reads it from. testType is always a framework
  // here (file uploads only happen for script test types).
  const key = testScriptKey(testType as LoadTestFramework, testId, ext.replace(/^\./, ""));

  const client =
    s3 ??
    new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

  await client.send(
    new PutObjectCommand({
      Bucket: config.scenariosBucket,
      Key: key,
      Body: readFileSync(filePath),
      ContentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      ContentLength: stats.size,
    })
  );

  return { key, fileType };
}

/**
 * Copy an already-uploaded script object to a new key within the scenarios
 * bucket. Used when copying a scenario: the script is keyed by testId, so the
 * duplicate needs its own copy under the new testId's key or the run can't find
 * the script.
 * @param api The API client (for bucket, region, and credentials).
 * @param sourceKey The existing object key.
 * @param destKey The new object key.
 * @param s3 Optional S3 client (injected in tests).
 */
export async function copyScriptObject(
  api: ApiClient,
  sourceKey: string,
  destKey: string,
  s3?: S3Client
): Promise<void> {
  const { config, awsCredentialIdentity: credentials } = api;

  if (!config.scenariosBucket) {
    throw new Error("Error: Scenarios bucket not configured. Run `dlt configure` with --scenarios-bucket");
  }

  const client =
    s3 ??
    new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

  await client.send(
    new CopyObjectCommand({
      Bucket: config.scenariosBucket,
      CopySource: `${config.scenariosBucket}/${sourceKey}`,
      Key: destKey,
    })
  );
}

/**
 * Duplicate a scenario's uploaded script to a new testId's key and return the
 * new script filename to store in the copy's testScenario.
 *
 * The scenarios bucket keys scripts by testId, so a copied scenario needs its
 * own object under the new testId. When `copyObject` is false (e.g. a dry run),
 * the S3 copy is skipped and only the new filename is computed.
 * @param api The API client.
 * @param params Framework, source/destination testIds, the current script
 *   filename (for its extension), and whether to perform the S3 copy.
 */
export async function copyScenarioScript(
  api: ApiClient,
  params: {
    testType: LoadTestFramework;
    fromTestId: string;
    toTestId: string;
    scriptFileName: string;
    copyObject: boolean;
  }
): Promise<string> {
  const ext = fileExtension(params.scriptFileName);
  if (params.copyObject) {
    await copyScriptObject(
      api,
      testScriptKey(params.testType, params.fromTestId, ext),
      testScriptKey(params.testType, params.toTestId, ext)
    );
  }
  return `${params.toTestId}.${ext}`;
}
