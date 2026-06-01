// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  AuthFlowType,
  ChallengeNameType,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  type InitiateAuthCommandInput,
  RespondToAuthChallengeCommand,
  type RespondToAuthChallengeCommandInput,
} from "@aws-sdk/client-cognito-identity-provider";
import { createSrpSession, signSrpSession, wrapAuthChallenge, wrapInitiateAuth } from "cognito-srp-helper";
import type { DltConfig } from "../config.js";

export interface SrpAuthResult {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Authenticate using USER_SRP_AUTH flow via the AWS SDK v3.
 *
 * Uses cognito-srp-helper for the SRP-6a math.
 * The password never travels over the wire in plain text.
 */
export async function srpAuthenticate(config: DltConfig, username: string, password: string): Promise<SrpAuthResult> {
  const client = new CognitoIdentityProviderClient({ region: config.region });
  // isHashed=false: the password is plaintext and the helper will hash it before computing the verifier.
  // The default is true, which would treat the password as already hashed and produce a wrong signature.
  const session = createSrpSession(username, password, config.userPoolId, false);

  const initiateAuthInput: InitiateAuthCommandInput = wrapInitiateAuth(session, {
    AuthFlow: AuthFlowType.USER_SRP_AUTH,
    ClientId: config.userPoolClientId,
    AuthParameters: { USERNAME: username },
  }) as InitiateAuthCommandInput;

  let initiateAuthResponse;
  try {
    initiateAuthResponse = await client.send(new InitiateAuthCommand(initiateAuthInput));
  } catch (err) {
    throw new Error(`SRP authentication failed: ${(err as Error).message}`);
  }

  if (initiateAuthResponse.ChallengeName !== ChallengeNameType.PASSWORD_VERIFIER) {
    throw new Error(`SRP authentication failed: unexpected challenge ${initiateAuthResponse.ChallengeName ?? "<none>"}`);
  }

  // Cast required: cognito-srp-helper's InitiateAuthResponse uses non-exact-optional fields
  // that conflict with the SDK's InitiateAuthCommandOutput under exactOptionalPropertyTypes.
  const signedSession = signSrpSession(session, initiateAuthResponse as unknown as Parameters<typeof signSrpSession>[1]);

  // USERNAME in the challenge response must match USER_ID_FOR_SRP — otherwise Cognito
  // rejects the password signature when the user signed in via an alias (email/phone).
  const userIdForSrp = initiateAuthResponse.ChallengeParameters?.["USER_ID_FOR_SRP"] ?? username;

  const challengeInput: RespondToAuthChallengeCommandInput = wrapAuthChallenge(signedSession, {
    ChallengeName: ChallengeNameType.PASSWORD_VERIFIER,
    ClientId: config.userPoolClientId,
    ChallengeResponses: { USERNAME: userIdForSrp },
  }) as RespondToAuthChallengeCommandInput;

  let challengeResponse;
  try {
    challengeResponse = await client.send(new RespondToAuthChallengeCommand(challengeInput));
  } catch (err) {
    throw new Error(`SRP authentication failed: ${(err as Error).message}`);
  }

  if (challengeResponse.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    throw new Error(
      "A new password is required. Please log in via the web console to set your permanent password, then retry."
    );
  }

  const auth = challengeResponse.AuthenticationResult;
  if (!auth?.IdToken || !auth.AccessToken || !auth.RefreshToken || auth.ExpiresIn === undefined) {
    throw new Error(
      `SRP authentication failed: incomplete authentication result${
        challengeResponse.ChallengeName ? ` (challenge: ${challengeResponse.ChallengeName})` : ""
      }`
    );
  }

  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
    expiresIn: auth.ExpiresIn,
  };
}
