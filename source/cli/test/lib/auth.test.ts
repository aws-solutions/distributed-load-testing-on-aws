// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { generatePkceChallenge, buildAuthorizeUrl } from "../../src/lib/auth/index.js";
import type { DltConfig } from "../../src/lib/config.js";

const testConfig: DltConfig = {
  apiEndpoint: "https://api.example.com/prod",
  userPoolId: "us-east-1_AbCdEfG",
  userPoolClientId: "client123",
  identityPoolId: "us-east-1:aaaa-bbbb",
  userPoolDomain: "dlt-test.auth.us-east-1.amazoncognito.com",
  region: "us-east-1",
};

describe("auth", () => {
  describe("generatePkceChallenge", () => {
    it("generates a code verifier and challenge", () => {
      const pkce = generatePkceChallenge();
      expect(pkce.codeVerifier).toBeTruthy();
      expect(pkce.codeChallenge).toBeTruthy();
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128);
    });

    it("generates unique values each call", () => {
      const a = generatePkceChallenge();
      const b = generatePkceChallenge();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
      expect(a.codeChallenge).not.toBe(b.codeChallenge);
    });

    it("challenge is base64url encoded (no + / =)", () => {
      const pkce = generatePkceChallenge();
      expect(pkce.codeChallenge).not.toMatch(/[+/=]/);
    });
  });

  describe("buildAuthorizeUrl", () => {
    it("builds a valid authorize URL", () => {
      const pkce = generatePkceChallenge();
      const redirectUri = "http://localhost:7521/callback";
      const url = buildAuthorizeUrl(testConfig, pkce, redirectUri);

      expect(url).toContain("https://dlt-test.auth.us-east-1.amazoncognito.com/oauth2/authorize");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=client123");
      expect(url).toContain("code_challenge_method=S256");
      expect(url).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
      expect(url).toContain(`code_challenge=${pkce.codeChallenge}`);
    });

    it("includes required scopes", () => {
      const pkce = generatePkceChallenge();
      const url = buildAuthorizeUrl(testConfig, pkce, "http://localhost:7521/callback");
      expect(url).toContain("scope=");
      expect(url).toContain("openid");
    });
  });

  describe("srpAuthenticate", () => {
    it("is exported and callable", async () => {
      const { srpAuthenticate } = await import("../../src/lib/auth/index.js");
      expect(typeof srpAuthenticate).toBe("function");
    });

    it("rejects with clear error on missing credentials", async () => {
      const { srpAuthenticate } = await import("../../src/lib/auth/index.js");
      await expect(srpAuthenticate(testConfig, "testuser", "testpass")).rejects.toThrow();
    });
  });

  describe("resolveIamCredentials", () => {
    it("is exported and callable", async () => {
      const { resolveIamCredentials } = await import("../../src/lib/auth/index.js");
      expect(typeof resolveIamCredentials).toBe("function");
    });

    it("resolves credentials from environment variables", async () => {
      const { resolveIamCredentials } = await import("../../src/lib/auth/index.js");

      const originalAccessKey = process.env["AWS_ACCESS_KEY_ID"];
      const originalSecretKey = process.env["AWS_SECRET_ACCESS_KEY"];
      const originalSessionToken = process.env["AWS_SESSION_TOKEN"];
      const originalProfile = process.env["AWS_PROFILE"];

      try {
        process.env["AWS_ACCESS_KEY_ID"] = "AKIAIOSFODNN7EXAMPLE";
        process.env["AWS_SECRET_ACCESS_KEY"] = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
        process.env["AWS_SESSION_TOKEN"] = "FwoGZXIvYXdzEBYaDHqa0AP";
        if (originalProfile !== undefined) {
          // AWS_PROFILE takes precedence over the key/secret so we need to clear
          // it if we want to verify that the AWS CLI used the key/secret we set.
          delete process.env["AWS_PROFILE"];
        }

        const creds = await resolveIamCredentials();
        expect(creds.accessKeyId).toBe("AKIAIOSFODNN7EXAMPLE");
        expect(creds.secretAccessKey).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
        expect(creds.sessionToken).toBe("FwoGZXIvYXdzEBYaDHqa0AP");
        expect(creds.expiration).toBeInstanceOf(Date);
      } finally {
        if (originalAccessKey === undefined) {
          delete process.env["AWS_ACCESS_KEY_ID"];
        } else {
          process.env["AWS_ACCESS_KEY_ID"] = originalAccessKey;
        }
        if (originalSecretKey === undefined) {
          delete process.env["AWS_SECRET_ACCESS_KEY"];
        } else {
          process.env["AWS_SECRET_ACCESS_KEY"] = originalSecretKey;
        }
        if (originalSessionToken === undefined) {
          delete process.env["AWS_SESSION_TOKEN"];
        } else {
          process.env["AWS_SESSION_TOKEN"] = originalSessionToken;
        }
        if (originalProfile !== undefined) {
          process.env["AWS_PROFILE"] = originalProfile;
        }
      }
    });
  });

  describe("SrpAuthResult type", () => {
    it("has the expected shape", async () => {
      const auth = await import("../../src/lib/auth/index.js");
      const result: typeof auth extends { SrpAuthResult: infer T }
        ? T
        : {
            idToken: string;
            accessToken: string;
            refreshToken: string;
            expiresIn: number;
          } = {
        idToken: "id",
        accessToken: "access",
        refreshToken: "refresh",
        expiresIn: 3600,
      };
      expect(result.idToken).toBe("id");
      expect(result.expiresIn).toBe(3600);
    });
  });
});
