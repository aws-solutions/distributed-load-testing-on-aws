// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/http-client.js", () => ({
  httpsPostForm: vi.fn(),
}));

import {
  generatePkceChallenge,
  buildAuthorizeUrl,
  startCallbackServer,
  exchangeCodeForTokens,
  refreshTokens,
} from "../../../src/lib/auth/pkce.js";
import { httpsPostForm } from "../../../src/lib/http-client.js";
import type { DltConfig } from "../../../src/lib/config.js";
import http from "node:http";

const testConfig: DltConfig = {
  apiEndpoint: "https://api.example.com/prod",
  userPoolId: "us-east-1_AbCdEfG",
  userPoolClientId: "client123",
  identityPoolId: "us-east-1:aaaa-bbbb",
  userPoolDomain: "dlt-test.auth.us-east-1.amazoncognito.com",
  region: "us-east-1",
};

describe("pkce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generatePkceChallenge", () => {
    it("returns verifier and challenge", () => {
      const pkce = generatePkceChallenge();
      expect(pkce.codeVerifier).toBeTruthy();
      expect(pkce.codeChallenge).toBeTruthy();
    });

    it("verifier is between 43 and 128 chars", () => {
      const pkce = generatePkceChallenge();
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128);
    });

    it("challenge is base64url (no +/=)", () => {
      const pkce = generatePkceChallenge();
      expect(pkce.codeChallenge).not.toMatch(/[+/=]/);
    });
  });

  describe("buildAuthorizeUrl", () => {
    it("contains the correct domain and params", () => {
      const pkce = generatePkceChallenge();
      const url = buildAuthorizeUrl(testConfig, pkce, "http://localhost:7521/callback");
      expect(url).toContain("dlt-test.auth.us-east-1.amazoncognito.com/oauth2/authorize");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=client123");
      expect(url).toContain("code_challenge_method=S256");
      expect(url).toContain(`code_challenge=${pkce.codeChallenge}`);
    });
  });

  describe("startCallbackServer", () => {
    it("resolves with code on successful callback", async () => {
      const port = 17521;
      const promise = startCallbackServer(port);

      // Make a request to the callback endpoint
      await new Promise<void>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/callback?code=test-code`, () => resolve());
        req.on("error", () => resolve());
      });

      const result = await promise;
      expect(result.code).toBe("test-code");
    });

    it("rejects on OAuth error", async () => {
      const port = 17522;
      const promise = startCallbackServer(port);

      // Add a catch handler immediately to prevent unhandled rejection
      const caught = promise.catch((e: Error) => e);

      await new Promise<void>((resolve) => {
        const req = http.get(
          `http://127.0.0.1:${port}/callback?error=access_denied&error_description=User+cancelled`,
          () => resolve()
        );
        req.on("error", () => resolve());
      });

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("OAuth error");
    });

    it("rejects when no code is provided", async () => {
      const port = 17523;
      const promise = startCallbackServer(port);

      // Add a catch handler immediately to prevent unhandled rejection
      const caught = promise.catch((e: Error) => e);

      await new Promise<void>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/callback`, () => resolve());
        req.on("error", () => resolve());
      });

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("No authorization code");
    });

    it("returns 404 for non-callback paths", async () => {
      const port = 17524;
      const serverPromise = startCallbackServer(port);

      const statusCode = await new Promise<number>((resolve) => {
        http.get(`http://127.0.0.1:${port}/other`, (res) => {
          resolve(res.statusCode ?? 0);
        });
      });

      expect(statusCode).toBe(404);

      // Clean up: send valid callback to resolve the promise
      await new Promise<void>((resolve) => {
        http.get(`http://127.0.0.1:${port}/callback?code=cleanup`, () => resolve());
      });
      await serverPromise;
    });
  });

  describe("exchangeCodeForTokens", () => {
    it("exchanges code for tokens successfully", async () => {
      vi.mocked(httpsPostForm).mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({
          id_token: "id-tok",
          access_token: "access-tok",
          refresh_token: "refresh-tok",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      });

      const result = await exchangeCodeForTokens(testConfig, "auth-code", "verifier", "http://localhost:7521/callback");

      expect(result.id_token).toBe("id-tok");
      expect(result.access_token).toBe("access-tok");
      expect(result.refresh_token).toBe("refresh-tok");
      expect(result.expires_in).toBe(3600);
    });

    it("throws on non-200 response", async () => {
      vi.mocked(httpsPostForm).mockResolvedValue({
        statusCode: 400,
        headers: {},
        body: "invalid_grant",
      });

      await expect(
        exchangeCodeForTokens(testConfig, "bad-code", "verifier", "http://localhost:7521/callback")
      ).rejects.toThrow("Token exchange failed");
    });

    it("throws on unparseable response", async () => {
      vi.mocked(httpsPostForm).mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: "not json",
      });

      await expect(
        exchangeCodeForTokens(testConfig, "code", "verifier", "http://localhost:7521/callback")
      ).rejects.toThrow("Failed to parse token response");
    });
  });

  describe("refreshTokens", () => {
    it("refreshes tokens successfully", async () => {
      vi.mocked(httpsPostForm).mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({
          id_token: "new-id-tok",
          access_token: "new-access-tok",
          refresh_token: "new-refresh-tok",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      });

      const result = await refreshTokens(testConfig, "old-refresh-tok");

      expect(result.id_token).toBe("new-id-tok");
      expect(result.access_token).toBe("new-access-tok");
    });

    it("throws on non-200 response", async () => {
      vi.mocked(httpsPostForm).mockResolvedValue({
        statusCode: 401,
        headers: {},
        body: "invalid_grant",
      });

      await expect(refreshTokens(testConfig, "expired-tok")).rejects.toThrow("Token exchange failed");
    });
  });
});
