// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from "@aws-sdk/client-cognito-identity";
import type { DltConfig } from "../config.js";
import type { AwsTemporaryCredentials } from "./iam.js";

/**
 * Exchange a Cognito ID token for AWS temporary credentials via Identity Pool.
 */
export async function getAwsCredentials(config: DltConfig, idToken: string): Promise<AwsTemporaryCredentials> {
  const client = new CognitoIdentityClient({ region: config.region });

  const providerName = `cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;

  const getIdResp = await client.send(
    new GetIdCommand({
      IdentityPoolId: config.identityPoolId,
      Logins: { [providerName]: idToken },
    })
  );

  if (!getIdResp.IdentityId) {
    throw new Error('Failed to get Identity ID from Cognito Identity Pool. Run "dlt login" again.');
  }

  const credsResp = await client.send(
    new GetCredentialsForIdentityCommand({
      IdentityId: getIdResp.IdentityId,
      Logins: { [providerName]: idToken },
    })
  );

  const creds = credsResp.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretKey || !creds.SessionToken || !creds.Expiration) {
    throw new Error('Incomplete credentials returned from Identity Pool. Run "dlt login" again.');
  }

  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretKey,
    sessionToken: creds.SessionToken,
    expiration: creds.Expiration,
  };
}
