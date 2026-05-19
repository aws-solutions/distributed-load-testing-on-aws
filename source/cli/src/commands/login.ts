// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import open from "open";
import { loadConfig } from "../lib/config.js";
import { saveCredentials } from "../lib/credentials.js";
import type { DltCredentials } from "../lib/credentials.js";
import { withErrorHandler } from "../lib/error-handler.js";
import {
  generatePkceChallenge,
  buildAuthorizeUrl,
  startCallbackServer,
  exchangeCodeForTokens,
  getAwsCredentials,
  srpAuthenticate,
  resolveIamCredentials,
} from "../lib/auth/index.js";

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with the DLT service")
    .option("--srp", "Use SRP (Secure Remote Password) headless authentication")
    .option("--iam", "Use ambient IAM credentials (skip Cognito entirely)")
    .option("-u, --username <username>", "Cognito username (SRP mode)")
    .option("-p, --password <password>", "Cognito password (SRP mode; prefer DLT_PASSWORD env var)")
    .action(withErrorHandler(handleLogin));
}

async function handleLogin(options: {
  srp?: boolean | undefined;
  iam?: boolean | undefined;
  username?: string | undefined;
  password?: string | undefined;
}): Promise<void> {
  if (options.srp && options.iam) {
    throw new Error("--srp and --iam are mutually exclusive. Choose one.");
  }

  if (options.iam) {
    await handleIamLogin();
  } else if (options.srp) {
    await handleSrpLogin(options);
  } else {
    await handleBrowserLogin();
  }
}

// ---------------------------------------------------------------------------
// Browser login (default)
// ---------------------------------------------------------------------------

const CLI_CALLBACK_PORTS = [7521, 3000];

/**
 * Attempt to start the callback server on each port in order.
 * Falls back to the next port when the current one is already in use (EADDRINUSE).
 */
async function startCallbackServerWithFallback(
  ports: number[]
): Promise<{ port: number; callbackPromise: Promise<{ code: string }> }> {
  for (const port of ports) {
    try {
      console.error(`Starting callback server on port ${port}.`);
      const callbackPromise = startCallbackServer(port);
      // If startCallbackServer doesn't throw synchronously, the server is listening.
      // We need to give the server a tick to actually bind and potentially error.
      await new Promise<void>((resolve, reject) => {
        // Small delay to allow the server to bind or fail
        const timer = setTimeout(resolve, 100);
        callbackPromise.catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return { port, callbackPromise };
    } catch (err: unknown) {
      const isAddressInUse = err instanceof Error && "code" in err && (err as { code?: string }).code === "EADDRINUSE";
      if (isAddressInUse && port !== ports[ports.length - 1]) {
        console.error(`Port ${port} is already in use. Trying next port.`);
        continue;
      }
      throw new Error(
        `Failed to start callback server. Ports tried: ${ports.join(", ")}. ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  // This should be unreachable, but satisfies TypeScript
  throw new Error(`Failed to start callback server on any port: ${ports.join(", ")}`);
}

async function handleBrowserLogin(): Promise<void> {
  const config = loadConfig();

  // 1. Generate PKCE challenge
  const pkce = generatePkceChallenge();

  // 2. Start local callback server (before opening browser), with fallback port
  const { port, callbackPromise } = await startCallbackServerWithFallback(CLI_CALLBACK_PORTS);
  const redirectUri = `http://localhost:${port}/callback`;

  // 3. Open browser to Cognito Hosted UI
  const authorizeUrl = buildAuthorizeUrl(config, pkce, redirectUri);
  console.error("Opening browser for authentication.");
  await open(authorizeUrl);
  console.error("Waiting for authentication callback (complete sign-in in browser).");

  // 4. Wait for callback with authorization code
  const { code } = await callbackPromise;
  console.error("Authorization code received. Exchanging for tokens.");

  // 5. Exchange code for Cognito tokens
  const tokenResp = await exchangeCodeForTokens(config, code, pkce.codeVerifier, redirectUri);
  console.error("Tokens received. Getting AWS credentials.");

  // 6. Exchange ID token for AWS temporary credentials
  const awsCreds = await getAwsCredentials(config, tokenResp.id_token);
  console.error("AWS credentials obtained.");

  // 7. Save everything
  saveCredentials({
    authMode: "browser",
    idToken: tokenResp.id_token,
    accessToken: tokenResp.access_token,
    refreshToken: tokenResp.refresh_token,
    tokenExpiry: new Date(Date.now() + tokenResp.expires_in * 1000).toISOString(),
    awsAccessKeyId: awsCreds.accessKeyId,
    awsSecretAccessKey: awsCreds.secretAccessKey,
    awsSessionToken: awsCreds.sessionToken,
    awsCredentialExpiry: awsCreds.expiration.toISOString(),
  });

  console.error("Login successful. Credentials saved to ~/.dlt/credentials.json");
}

// ---------------------------------------------------------------------------
// SRP headless login
// ---------------------------------------------------------------------------

async function handleSrpLogin(options: {
  username?: string | undefined;
  password?: string | undefined;
}): Promise<void> {
  const config = loadConfig();

  const username = options.username;
  if (!username) {
    throw new Error("--username is required for SRP authentication.");
  }

  // Password: CLI flag → environment variable
  const password = options.password ?? process.env["DLT_PASSWORD"];
  if (!password) {
    throw new Error(
      "Password is required for SRP authentication.\n" +
        "Provide via --password flag or DLT_PASSWORD environment variable."
    );
  }

  console.error(`Authenticating as ${username} via SRP.`);
  const srpResult = await srpAuthenticate(config, username, password);
  console.error("SRP authentication successful. Getting AWS credentials.");

  // Exchange ID token for AWS credentials via Identity Pool
  const awsCreds = await getAwsCredentials(config, srpResult.idToken);
  console.error("AWS credentials obtained.");

  saveCredentials({
    authMode: "srp",
    idToken: srpResult.idToken,
    accessToken: srpResult.accessToken,
    refreshToken: srpResult.refreshToken,
    tokenExpiry: new Date(Date.now() + srpResult.expiresIn * 1000).toISOString(),
    awsAccessKeyId: awsCreds.accessKeyId,
    awsSecretAccessKey: awsCreds.secretAccessKey,
    awsSessionToken: awsCreds.sessionToken,
    awsCredentialExpiry: awsCreds.expiration.toISOString(),
  });

  console.error("Login successful. Credentials saved to ~/.dlt/credentials.json");
}

// ---------------------------------------------------------------------------
// IAM direct login
// ---------------------------------------------------------------------------

async function handleIamLogin(): Promise<void> {
  // Config is still needed for apiEndpoint / region, but Cognito is skipped
  loadConfig(); // Validate config exists

  console.error("Resolving AWS credentials from environment.");
  const awsCreds = await resolveIamCredentials();
  console.error("AWS credentials resolved.");

  const creds: DltCredentials = {
    authMode: "iam",
    awsAccessKeyId: awsCreds.accessKeyId,
    awsSecretAccessKey: awsCreds.secretAccessKey,
    awsSessionToken: awsCreds.sessionToken,
    awsCredentialExpiry: awsCreds.expiration.toISOString(),
  };

  saveCredentials(creds);
  console.error(
    "Login successful (IAM mode). Credentials saved to ~/.dlt/credentials.json\n" +
      "Note: Ensure your IAM role has execute-api:Invoke permission on the DLT API Gateway."
  );
}
