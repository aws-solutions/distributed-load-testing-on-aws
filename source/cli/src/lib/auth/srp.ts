// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DltConfig } from "../config.js";

export interface SrpAuthResult {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Authenticate using USER_SRP_AUTH flow via the AWS SDK.
 *
 * Uses the amazon-cognito-identity-js library to handle the SRP-6a math.
 * The password never travels over the wire in plain text.
 */
export async function srpAuthenticate(config: DltConfig, username: string, password: string): Promise<SrpAuthResult> {
  // amazon-cognito-identity-js uses CommonJS globals; dynamic import for ESM compat
  const cognitoIdentityJs = await import("amazon-cognito-identity-js");

  const poolData = {
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
  };
  const userPool = new cognitoIdentityJs.CognitoUserPool(poolData);
  const cognitoUser = new cognitoIdentityJs.CognitoUser({
    Username: username,
    Pool: userPool,
  });
  const authDetails = new cognitoIdentityJs.AuthenticationDetails({
    Username: username,
    Password: password,
  });

  return new Promise<SrpAuthResult>((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess(session) {
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
          expiresIn: session.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000),
        });
      },
      onFailure(err: Error) {
        reject(new Error(`SRP authentication failed: ${err.message}`));
      },
      newPasswordRequired() {
        reject(
          new Error(
            "A new password is required. Please log in via the web console to set your permanent password, then retry."
          )
        );
      },
    });
  });
}
