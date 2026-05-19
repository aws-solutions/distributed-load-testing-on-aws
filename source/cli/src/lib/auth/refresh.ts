// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DltConfig } from "../config.js";
import type { DltCredentials } from "../credentials.js";
import { saveCredentials, isTokenExpired, isAwsCredentialExpired } from "../credentials.js";
import { refreshTokens } from "./pkce.js";
import { resolveIamCredentials } from "./iam.js";
import { getAwsCredentials } from "./identity-pool.js";

/**
 * Ensure credentials are valid, refreshing if needed.
 * Handles all three auth modes: browser, srp, and iam.
 * Returns updated credentials (also saves to disk).
 */
export async function ensureValidCredentials(config: DltConfig, creds: DltCredentials): Promise<DltCredentials> {
  // IAM mode: re-resolve from provider chain if expired
  if (creds.authMode === "iam") {
    if (!isAwsCredentialExpired(creds)) {
      return creds;
    }
    const awsCreds = await resolveIamCredentials();
    const updated: DltCredentials = {
      authMode: "iam",
      awsAccessKeyId: awsCreds.accessKeyId,
      awsSecretAccessKey: awsCreds.secretAccessKey,
      awsSessionToken: awsCreds.sessionToken,
      awsCredentialExpiry: awsCreds.expiration.toISOString(),
    };
    saveCredentials(updated);
    return updated;
  }

  // Browser and SRP modes: use Cognito tokens + Identity Pool
  if (!isAwsCredentialExpired(creds) && !isTokenExpired(creds)) {
    return creds;
  }

  // If token expired, try refresh
  if (isTokenExpired(creds)) {
    if (!creds.refreshToken) {
      throw new Error('Session expired and no refresh token available. Run "dlt login" again.');
    }
    try {
      const tokenResp = await refreshTokens(config, creds.refreshToken);
      creds = {
        ...creds,
        idToken: tokenResp.id_token,
        accessToken: tokenResp.access_token,
        // refresh_token may not be returned on refresh grant
        refreshToken: tokenResp.refresh_token ?? creds.refreshToken,
        tokenExpiry: new Date(Date.now() + tokenResp.expires_in * 1000).toISOString(),
      };
    } catch {
      throw new Error('Session expired and refresh failed. Run "dlt login" again.');
    }
  }

  // Exchange for fresh AWS credentials
  if (!creds.idToken) {
    throw new Error('No ID token available. Run "dlt login" again.');
  }
  const awsCreds = await getAwsCredentials(config, creds.idToken);
  const updated: DltCredentials = {
    ...creds,
    awsAccessKeyId: awsCreds.accessKeyId,
    awsSecretAccessKey: awsCreds.secretAccessKey,
    awsSessionToken: awsCreds.sessionToken,
    awsCredentialExpiry: awsCreds.expiration.toISOString(),
  };

  saveCredentials(updated);
  return updated;
}
