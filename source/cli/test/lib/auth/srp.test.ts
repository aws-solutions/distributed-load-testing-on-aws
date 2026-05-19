// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuthenticateUser = vi.fn();

vi.mock("amazon-cognito-identity-js", () => ({
  CognitoUserPool: vi.fn(function () {
    return {};
  }),
  CognitoUser: vi.fn(function () {
    return { authenticateUser: mockAuthenticateUser };
  }),
  AuthenticationDetails: vi.fn(function () {
    return {};
  }),
}));

import { srpAuthenticate } from "../../../src/lib/auth/srp.js";
import type { DltConfig } from "../../../src/lib/config.js";

const testConfig: DltConfig = {
  apiEndpoint: "https://api.example.com/prod",
  userPoolId: "us-east-1_AbCdEfG",
  userPoolClientId: "client123",
  identityPoolId: "us-east-1:aaaa-bbbb",
  userPoolDomain: "dlt-test.auth.us-east-1.amazoncognito.com",
  region: "us-east-1",
};

describe("srp - srpAuthenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with tokens on successful authentication", async () => {
    const mockSession = {
      getIdToken: () => ({ getJwtToken: () => "id-jwt" }),
      getAccessToken: () => ({
        getJwtToken: () => "access-jwt",
        getExpiration: () => Math.floor(Date.now() / 1000) + 3600,
      }),
      getRefreshToken: () => ({ getToken: () => "refresh-tok" }),
    };

    mockAuthenticateUser.mockImplementation(
      (_authDetails: unknown, callbacks: { onSuccess: (session: unknown) => void }) => {
        callbacks.onSuccess(mockSession);
      }
    );

    const result = await srpAuthenticate(testConfig, "user", "pass");

    expect(result.idToken).toBe("id-jwt");
    expect(result.accessToken).toBe("access-jwt");
    expect(result.refreshToken).toBe("refresh-tok");
    expect(result.expiresIn).toBeGreaterThan(0);
  });

  it("rejects with error on authentication failure", async () => {
    mockAuthenticateUser.mockImplementation((_authDetails: unknown, callbacks: { onFailure: (err: Error) => void }) => {
      callbacks.onFailure(new Error("Incorrect username or password"));
    });

    await expect(srpAuthenticate(testConfig, "user", "wrongpass")).rejects.toThrow("SRP authentication failed");
  });

  it("rejects when new password is required", async () => {
    mockAuthenticateUser.mockImplementation((_authDetails: unknown, callbacks: { newPasswordRequired: () => void }) => {
      callbacks.newPasswordRequired();
    });

    await expect(srpAuthenticate(testConfig, "user", "pass")).rejects.toThrow("new password is required");
  });
});
