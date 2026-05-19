// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DLT_DIR, ensureDltDir } from "./paths.js";
import type { AwsCredentialIdentity } from "./http-client.js";

const CREDENTIALS_FILE = join(DLT_DIR, "credentials.json");

export type AuthMode = "browser" | "srp" | "iam";

export interface DltCredentials {
  /** Authentication mode used to obtain these credentials */
  authMode: AuthMode;

  /** Cognito tokens from OAuth or SRP flow (not present for IAM mode) */
  idToken?: string | undefined;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  tokenExpiry?: string | undefined; // ISO 8601

  /** AWS temporary credentials from Identity Pool or IAM role */
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken: string;
  awsCredentialExpiry: string; // ISO 8601
}

export function credentialsExist(): boolean {
  return existsSync(CREDENTIALS_FILE);
}

export function loadCredentials(): DltCredentials {
  if (!existsSync(CREDENTIALS_FILE)) {
    throw new Error(`Credentials not found. Run "dlt login" first.\nExpected: ${CREDENTIALS_FILE}`);
  }
  const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
  const parsed = JSON.parse(raw) as DltCredentials;
  // Default authMode for credentials saved before this field existed
  if (!parsed.authMode) {
    parsed.authMode = "browser";
  }
  return parsed;
}

export function saveCredentials(creds: DltCredentials): void {
  ensureDltDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
}

export function isTokenExpired(creds: DltCredentials): boolean {
  if (!creds.tokenExpiry) {
    return true;
  }
  const expiry = new Date(creds.tokenExpiry).getTime();
  // Consider expired 60 seconds before actual expiry for safety margin
  return Date.now() >= expiry - 60_000;
}

export function isAwsCredentialExpired(creds: DltCredentials): boolean {
  const expiry = new Date(creds.awsCredentialExpiry).getTime();
  return Date.now() >= expiry - 60_000;
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_FILE)) {
    unlinkSync(CREDENTIALS_FILE);
  }
}

/**
 * Extract an AwsCredentialIdentity from DltCredentials for use with S3 / other AWS clients.
 */
export function toAwsCredentialIdentity(creds: DltCredentials): AwsCredentialIdentity {
  return {
    accessKeyId: creds.awsAccessKeyId,
    secretAccessKey: creds.awsSecretAccessKey,
    sessionToken: creds.awsSessionToken,
  };
}
