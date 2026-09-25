// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  getRequiredEnv,
  isFileType,
  isTestType,
  type FileType,
  type LoadTestFramework,
  type TestType,
} from "@amzn/dlt-common";

/** Parsed from container environment variables set by task-runner Lambda. */
export interface ContainerConfig {
  readonly s3Bucket: string;
  readonly testId: string;
  readonly testRunId: string;
  readonly testType: TestType;
  readonly fileType: FileType;
  readonly prefix: string;
  /** Parsed from `LIVE_DATA_ENABLED` (literal `"live=true"` / `"live=false"`). */
  readonly liveDataEnabled: boolean;
  readonly mainStackRegion: string;
  readonly awsRegion: string;
  readonly ecsMetadataUri: string;
  readonly maxDurationSeconds: number;
}

/** Resolved config passed to FrameworkRunner methods.
 *  Constructed after script download, when local paths are known. */
export interface RunnerConfig {
  readonly testId: string;
  readonly framework: LoadTestFramework;
  readonly awsRegion: string;
  readonly liveDataEnabled: boolean;
  /** Absolute path to the downloaded user script. */
  readonly testScriptPath: string;
  /** Absolute path to the directory runners write output files into. */
  readonly artifactsDir: string;
}

export function parseEnv(): ContainerConfig {
  return {
    s3Bucket: getRequiredEnv("S3_BUCKET"),
    testId: getRequiredEnv("TEST_ID"),
    testRunId: getRequiredEnv("TEST_RUN_ID"),
    testType: parseTestType(),
    fileType: parseFileType(),
    prefix: getRequiredEnv("PREFIX"),
    liveDataEnabled: parseLiveDataEnabled(),
    mainStackRegion: getRequiredEnv("MAIN_STACK_REGION"),
    awsRegion: getRequiredEnv("AWS_REGION"),
    ecsMetadataUri: getRequiredEnv("ECS_CONTAINER_METADATA_URI_V4"),
    maxDurationSeconds: parseRequiredPositiveInteger("MAX_DURATION_SECONDS"),
  };
}

/** Parse a required env var as a positive integer (the only numeric env DLT reads). */
function parseRequiredPositiveInteger(name: string): number {
  const raw = getRequiredEnv(name);
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable "${name}" has invalid value "${raw}". Expected a positive integer.`);
  }
  return value;
}

function parseTestType(): TestType {
  const value = getRequiredEnv("TEST_TYPE");
  if (!isTestType(value)) {
    throw new Error(
      `Environment variable "TEST_TYPE" has invalid value "${value}". Expected one of: simple, jmeter, k6, locust`
    );
  }
  return value;
}

// FILE_TYPE may be absent or empty on some code paths (simple-mode
// tests have no user-supplied script); treat those as "none" so the
// caller gets a concrete value to branch on.
function parseFileType(): FileType {
  const raw = process.env["FILE_TYPE"]?.trim();
  if (raw === undefined || raw === "") return "none";
  if (!isFileType(raw)) {
    throw new Error(`Environment variable "FILE_TYPE" has invalid value "${raw}". Expected one of: none, script, zip`);
  }
  return raw;
}

// task-runner sets LIVE_DATA_ENABLED as the literal string "live=true"
// or "live=false" because the CloudWatch Logs subscription filter for
// the Taurus-mode live-data Lambda matches on that exact token. The
// format is preserved even though v2 does not produce Taurus-mode logs.
function parseLiveDataEnabled(): boolean {
  const raw = getRequiredEnv("LIVE_DATA_ENABLED");
  if (raw === "live=true") return true;
  if (raw === "live=false") return false;
  throw new Error(
    `Environment variable "LIVE_DATA_ENABLED" has invalid value "${raw}". Expected "live=true" or "live=false".`
  );
}
