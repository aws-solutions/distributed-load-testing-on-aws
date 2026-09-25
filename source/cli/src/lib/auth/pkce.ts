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

/** Default browser-login callback timeout: 5 minutes. */
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

/**
 * Upper bound for the login callback wait: 1 hour. Generous for any legitimate
 * sign-in, and well under Node's `setTimeout` ceiling (2^31 - 1 ms) so a large
 * override is capped here rather than silently clamped to 1ms (which would fire
 * almost immediately — the opposite of the intended long wait).
 */
const MAX_LOGIN_TIMEOUT_MS = 3_600_000;

/**
 * Resolve the browser-login callback timeout (ms) from `DLT_LOGIN_TIMEOUT_MS`,
 * falling back to {@link DEFAULT_LOGIN_TIMEOUT_MS} when unset or invalid, and
 * capped at {@link MAX_LOGIN_TIMEOUT_MS}.
 */
export function getLoginTimeoutMs(): number {
  const raw = process.env["DLT_LOGIN_TIMEOUT_MS"];
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_LOGIN_TIMEOUT_MS);
    }
  }
  return DEFAULT_LOGIN_TIMEOUT_MS;
}

/**
 * Start a local HTTP server to capture the OAuth callback.
 * Resolves with the authorization code when the callback is received.
 *
 * The server binds to `localhost` (not a hardcoded `127.0.0.1`) so it listens
 * on whatever address `localhost` resolves to — the same resolution the browser
 * uses for the redirect URI. This avoids a hang on systems where `localhost`
 * resolves to IPv6 `::1` while the server only listened on IPv4.
 *
 * If no callback arrives within {@link timeoutMs} the server is closed and the
 * promise rejects, so an abandoned or closed browser tab cannot hang the CLI.
 * @param port The loopback port to listen on.
 * @param timeoutMs Milliseconds to wait for the callback (default from env).
 * @param host The loopback host to bind to; defaults to `localhost` so the
 *   server mirrors the browser's resolution of the redirect URI. Tests may pin
 *   this to a single family (e.g. `127.0.0.1`) for deterministic connections.
 */
export function startCallbackServer(
  port: number,
  timeoutMs: number = getLoginTimeoutMs(),
  host = "localhost"
): Promise<{ code: string; server: http.Server }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

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
        fail(new Error(`OAuth error: ${description}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Error</h2><p>No authorization code received.</p></body></html>`);
        fail(new Error("No authorization code in callback"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body><h2>Authentication Successful</h2><p>You can close this window and return to the terminal.</p></body></html>`
      );
      succeed(code);
    });

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      server.close();
    };

    const succeed = (code: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, server });
    };

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    server.on("error", fail);
    server.listen(port, host);

    timer = setTimeout(() => {
      fail(
        new Error(
          `Login timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser callback. ` +
            `Re-run "dlt login" and complete sign-in in the browser, ` +
            `or set DLT_LOGIN_TIMEOUT_MS to allow more time.`
        )
      );
    }, timeoutMs);
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
