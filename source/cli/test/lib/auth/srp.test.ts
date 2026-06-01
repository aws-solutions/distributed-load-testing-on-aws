// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  AuthFlowType: { USER_SRP_AUTH: "USER_SRP_AUTH" },
  ChallengeNameType: { PASSWORD_VERIFIER: "PASSWORD_VERIFIER" },
  CognitoIdentityProviderClient: vi.fn(function () {
    return { send: mockSend };
  }),
  InitiateAuthCommand: vi.fn(function (input: unknown) {
    return { __type: "InitiateAuth", input };
  }),
  RespondToAuthChallengeCommand: vi.fn(function (input: unknown) {
    return { __type: "RespondToAuthChallenge", input };
  }),
}));

vi.mock("cognito-srp-helper", () => ({
  createSrpSession: vi.fn(() => ({ __session: true })),
  signSrpSession: vi.fn(() => ({ __signed: true })),
  wrapInitiateAuth: vi.fn((_session, request) => request),
  wrapAuthChallenge: vi.fn((_session, request) => request),
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
    mockSend
      .mockResolvedValueOnce({
        ChallengeName: "PASSWORD_VERIFIER",
        ChallengeParameters: { SRP_B: "b", SALT: "salt", SECRET_BLOCK: "sb", USER_ID_FOR_SRP: "user" },
      })
      .mockResolvedValueOnce({
        AuthenticationResult: {
          IdToken: "id-jwt",
          AccessToken: "access-jwt",
          RefreshToken: "refresh-tok",
          ExpiresIn: 3600,
        },
      });

    const result = await srpAuthenticate(testConfig, "user", "pass");

    expect(result.idToken).toBe("id-jwt");
    expect(result.accessToken).toBe("access-jwt");
    expect(result.refreshToken).toBe("refresh-tok");
    expect(result.expiresIn).toBe(3600);
  });

  it("rejects with error on authentication failure", async () => {
    mockSend.mockRejectedValueOnce(new Error("Incorrect username or password"));

    await expect(srpAuthenticate(testConfig, "user", "wrongpass")).rejects.toThrow(
      "SRP authentication failed: Incorrect username or password"
    );
  });

  it("rejects when new password is required", async () => {
    mockSend
      .mockResolvedValueOnce({
        ChallengeName: "PASSWORD_VERIFIER",
        ChallengeParameters: { SRP_B: "b", SALT: "salt", SECRET_BLOCK: "sb", USER_ID_FOR_SRP: "user" },
      })
      .mockResolvedValueOnce({
        ChallengeName: "NEW_PASSWORD_REQUIRED",
      });

    await expect(srpAuthenticate(testConfig, "user", "pass")).rejects.toThrow("new password is required");
  });

  it("rejects when InitiateAuth returns an unexpected challenge", async () => {
    mockSend.mockResolvedValueOnce({ ChallengeName: "MFA_SETUP" });

    await expect(srpAuthenticate(testConfig, "user", "pass")).rejects.toThrow(
      "SRP authentication failed: unexpected challenge MFA_SETUP"
    );
  });

  it("rejects when RespondToAuthChallenge fails", async () => {
    mockSend
      .mockResolvedValueOnce({
        ChallengeName: "PASSWORD_VERIFIER",
        ChallengeParameters: { SRP_B: "b", SALT: "salt", SECRET_BLOCK: "sb", USER_ID_FOR_SRP: "user" },
      })
      .mockRejectedValueOnce(new Error("NotAuthorizedException"));

    await expect(srpAuthenticate(testConfig, "user", "pass")).rejects.toThrow(
      "SRP authentication failed: NotAuthorizedException"
    );
  });

  it("rejects when challenge response has no AuthenticationResult", async () => {
    mockSend
      .mockResolvedValueOnce({
        ChallengeName: "PASSWORD_VERIFIER",
        ChallengeParameters: { SRP_B: "b", SALT: "salt", SECRET_BLOCK: "sb", USER_ID_FOR_SRP: "user" },
      })
      .mockResolvedValueOnce({});

    await expect(srpAuthenticate(testConfig, "user", "pass")).rejects.toThrow(
      "SRP authentication failed: incomplete authentication result"
    );
  });
});
