// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentity } from "../http-client.js";

export interface AwsTemporaryCredentials extends AwsCredentialIdentity {
  expiration: Date;
}

/**
 * Resolve AWS credentials from the default provider chain.
 * Works with: environment variables, shared credentials/config files,
 * SSO, ECS task roles, EC2 instance metadata, etc.
 */
export async function resolveIamCredentials(): Promise<AwsTemporaryCredentials> {
  let creds;
  try {
    const provider = fromNodeProviderChain();
    creds = await provider();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to resolve AWS credentials. Run "dlt login --iam" or check your AWS environment.\nDetails: ${detail}`
    );
  }

  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error(
      "Could not resolve AWS credentials from the environment. " +
        'Run "dlt login --iam" after ensuring AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are set, ' +
        "or that an IAM role is available (instance profile, ECS task role, etc.)."
    );
  }

  // sessionToken may be undefined for long-term IAM user keys
  const sessionToken = creds.sessionToken ?? "";

  // expiration may be undefined for static credentials — default to 1 hour
  const expiration = creds.expiration ?? new Date(Date.now() + 3_600_000);

  return {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken,
    expiration,
  };
}
