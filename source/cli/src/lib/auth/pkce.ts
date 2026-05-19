// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { randomBytes, createHash } from "node:crypto";
import http from "node:http";
import { URL, URLSearchParams } from "node:url";
import { httpsPostForm } from "../http-client.js";
import type { DltConfig } from "../config.js";

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

export interface CognitoTokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Generate a PKCE code verifier and challenge pair.
 */
export function generatePkceChallenge(): PkceChallenge {
  const codeVerifier = randomBytes(32)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9\-._~]/g, "")
    .slice(0, 128);

  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return { codeVerifier, codeChallenge };
}

/**
 * Build the Cognito Hosted UI authorization URL.
 */
export function buildAuthorizeUrl(config: DltConfig, pkce: PkceChallenge, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.userPoolClientId,
    redirect_uri: redirectUri,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "S256",
    scope: "openid email profile",
  });
  return `https://${config.userPoolDomain}/oauth2/authorize?${params.toString()}`;
}

/**
 * Start a local HTTP server to capture the OAuth callback.
 * Resolves with the authorization code when the callback is received.
 */
export function startCallbackServer(port: number): Promise<{ code: string; server: http.Server }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h2>Authentication Failed</h2><p>${description}</p><p>You can close this window.</p></body></html>`
        );
        server.close();
        reject(new Error(`OAuth error: ${description}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Error</h2><p>No authorization code received.</p></body></html>`);
        server.close();
        reject(new Error("No authorization code in callback"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body><h2>Authentication Successful</h2><p>You can close this window and return to the terminal.</p></body></html>`
      );
      server.close();
      resolve({ code, server });
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Exchange an authorization code for Cognito tokens.
 */
export async function exchangeCodeForTokens(
  config: DltConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.userPoolClientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }).toString();

  return postToTokenEndpoint(config.userPoolDomain, body);
}

/**
 * Refresh Cognito tokens using a refresh token.
 */
export async function refreshTokens(config: DltConfig, refreshToken: string): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.userPoolClientId,
  }).toString();

  return postToTokenEndpoint(config.userPoolDomain, body);
}

async function postToTokenEndpoint(domain: string, body: string): Promise<CognitoTokenResponse> {
  const resp = await httpsPostForm(`https://${domain}/oauth2/token`, body);

  if (resp.statusCode !== 200) {
    throw new Error(`Token exchange failed (HTTP ${resp.statusCode}): ${resp.body}`);
  }

  try {
    return JSON.parse(resp.body) as CognitoTokenResponse;
  } catch {
    throw new Error(`Failed to parse token response: ${resp.body}`);
  }
}
