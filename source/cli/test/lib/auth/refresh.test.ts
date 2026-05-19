// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSaveCredentials = vi.fn();
const mockIsTokenExpired = vi.fn();
const mockIsAwsCredentialExpired = vi.fn();

vi.mock("../../../src/lib/credentials.js", () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
  isTokenExpired: (...args: unknown[]) => mockIsTokenExpired(...args),
  isAwsCredentialExpired: (...args: unknown[]) => mockIsAwsCredentialExpired(...args),
}));

const mockRefreshTokens = vi.fn();
vi.mock("../../../src/lib/auth/pkce.js", () => ({
  refreshTokens: (...args: unknown[]) => mockRefreshTokens(...args),
}));

const mockResolveIamCredentials = vi.fn();
vi.mock("../../../src/lib/auth/iam.js", () => ({
  resolveIamCredentials: (...args: unknown[]) => mockResolveIamCredentials(...args),
}));

const mockGetAwsCredentials = vi.fn();
vi.mock("../../../src/lib/auth/identity-pool.js", () => ({
  getAwsCredentials: (...args: unknown[]) => mockGetAwsCredentials(...args),
}));

import { ensureValidCredentials } from "../../../src/lib/auth/refresh.js";
import type { DltConfig } from "../../../src/lib/config.js";
import type { DltCredentials } from "../../../src/lib/credentials.js";

const testConfig: DltConfig = {
  apiEndpoint: "https://api.example.com/prod",
  userPoolId: "us-east-1_AbCdEfG",
  userPoolClientId: "client123",
  identityPoolId: "us-east-1:aaaa-bbbb",
  userPoolDomain: "dlt-test.auth.us-east-1.amazoncognito.com",
  region: "us-east-1",
};

describe("refresh - ensureValidCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("IAM mode", () => {
    const iamCreds: DltCredentials = {
      authMode: "iam",
      awsAccessKeyId: "AKID",
      awsSecretAccessKey: "SECRET",
      awsSessionToken: "TOKEN",
      awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
    };

    it("returns existing credentials when not expired", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(false);
      const result = await ensureValidCredentials(testConfig, iamCreds);
      expect(result).toBe(iamCreds);
      expect(mockResolveIamCredentials).not.toHaveBeenCalled();
    });

    it("refreshes credentials when expired", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(true);
      mockResolveIamCredentials.mockResolvedValue({
        accessKeyId: "NEW-AKID",
        secretAccessKey: "NEW-SECRET",
        sessionToken: "NEW-TOKEN",
        expiration: new Date("2025-01-01T00:00:00Z"),
      });

      const result = await ensureValidCredentials(testConfig, iamCreds);
      expect(result.authMode).toBe("iam");
      expect(result.awsAccessKeyId).toBe("NEW-AKID");
      expect(mockSaveCredentials).toHaveBeenCalled();
    });
  });

  describe("browser/SRP mode", () => {
    const browserCreds: DltCredentials = {
      authMode: "browser",
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      awsAccessKeyId: "AKID",
      awsSecretAccessKey: "SECRET",
      awsSessionToken: "TOKEN",
      awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
    };

    it("returns existing credentials when nothing is expired", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(false);
      mockIsTokenExpired.mockReturnValue(false);

      const result = await ensureValidCredentials(testConfig, browserCreds);
      expect(result).toBe(browserCreds);
      expect(mockRefreshTokens).not.toHaveBeenCalled();
    });

    it("refreshes tokens when token is expired", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(true);
      mockIsTokenExpired.mockReturnValue(true);
      mockRefreshTokens.mockResolvedValue({
        id_token: "new-id",
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      });
      mockGetAwsCredentials.mockResolvedValue({
        accessKeyId: "NEW-AKID",
        secretAccessKey: "NEW-SECRET",
        sessionToken: "NEW-TOKEN",
        expiration: new Date("2025-01-01T00:00:00Z"),
      });

      const result = await ensureValidCredentials(testConfig, browserCreds);
      expect(result.awsAccessKeyId).toBe("NEW-AKID");
      expect(mockSaveCredentials).toHaveBeenCalled();
    });

    it("throws when token expired and no refresh token", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(true);
      mockIsTokenExpired.mockReturnValue(true);

      const noRefreshCreds: DltCredentials = {
        ...browserCreds,
        refreshToken: undefined,
      };

      await expect(ensureValidCredentials(testConfig, noRefreshCreds)).rejects.toThrow("no refresh token");
    });

    it("throws when token refresh fails", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(true);
      mockIsTokenExpired.mockReturnValue(true);
      mockRefreshTokens.mockRejectedValue(new Error("refresh failed"));

      await expect(ensureValidCredentials(testConfig, browserCreds)).rejects.toThrow("refresh failed");
    });

    it("refreshes AWS creds only when token is valid but AWS creds expired", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(true);
      mockIsTokenExpired.mockReturnValue(false);
      mockGetAwsCredentials.mockResolvedValue({
        accessKeyId: "NEW-AKID",
        secretAccessKey: "NEW-SECRET",
        sessionToken: "NEW-TOKEN",
        expiration: new Date("2025-01-01T00:00:00Z"),
      });

      const result = await ensureValidCredentials(testConfig, browserCreds);
      expect(result.awsAccessKeyId).toBe("NEW-AKID");
      expect(mockRefreshTokens).not.toHaveBeenCalled();
      expect(mockGetAwsCredentials).toHaveBeenCalled();
    });

    it("throws when no idToken available for AWS cred exchange", async () => {
      mockIsAwsCredentialExpired.mockReturnValue(true);
      mockIsTokenExpired.mockReturnValue(false);

      const noIdCreds: DltCredentials = {
        ...browserCreds,
        idToken: undefined,
      };

      await expect(ensureValidCredentials(testConfig, noIdCreds)).rejects.toThrow("No ID token");
    });
  });
});
