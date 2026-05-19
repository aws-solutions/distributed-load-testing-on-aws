// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Barrel re-export for all auth modules.
// Consumers can import from "./auth/index.js" or individual sub-modules.

export {
  generatePkceChallenge,
  buildAuthorizeUrl,
  startCallbackServer,
  exchangeCodeForTokens,
  refreshTokens,
} from "./pkce.js";
export type { PkceChallenge, CognitoTokenResponse } from "./pkce.js";

export { srpAuthenticate } from "./srp.js";
export type { SrpAuthResult } from "./srp.js";

export { resolveIamCredentials } from "./iam.js";
export type { AwsTemporaryCredentials } from "./iam.js";

export { getAwsCredentials } from "./identity-pool.js";

export { ensureValidCredentials } from "./refresh.js";
