// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-cognito-identity", () => ({
  CognitoIdentityClient: vi.fn(function () {
    return { send: mockSend };
  }),
  GetIdCommand: vi.fn(function (input: unknown) {
    return { input, _type: "GetId" };
  }),
  GetCredentialsForIdentityCommand: vi.fn(function (input: unknown) {
    return { input, _type: "GetCredentials" };
  }),
}));

import { getAwsCredentials } from "../../../src/lib/auth/identity-pool.js";
import type { DltConfig } from "../../../src/lib/config.js";

const testConfig: DltConfig = {
  apiEndpoint: "https://api.example.com/prod",
  userPoolId: "us-east-1_AbCdEfG",
  userPoolClientId: "client123",
  identityPoolId: "us-east-1:aaaa-bbbb",
  userPoolDomain: "dlt-test.auth.us-east-1.amazoncognito.com",
  region: "us-east-1",
};

describe("identity-pool - getAwsCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges an ID token for AWS credentials", async () => {
    const expDate = new Date("2025-01-01T00:00:00Z");

    mockSend
      .mockResolvedValueOnce({
        IdentityId: "us-east-1:identity-id-123",
      })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: "AKID",
          SecretKey: "SECRET",
          SessionToken: "TOKEN",
          Expiration: expDate,
        },
      });

    const result = await getAwsCredentials(testConfig, "test-id-token");

    expect(result.accessKeyId).toBe("AKID");
    expect(result.secretAccessKey).toBe("SECRET");
    expect(result.sessionToken).toBe("TOKEN");
    expect(result.expiration).toBe(expDate);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("throws when IdentityId is missing", async () => {
    mockSend.mockResolvedValueOnce({
      IdentityId: undefined,
    });

    await expect(getAwsCredentials(testConfig, "test-id-token")).rejects.toThrow("Failed to get Identity ID");
  });

  it("throws when credentials are incomplete (missing AccessKeyId)", async () => {
    mockSend
      .mockResolvedValueOnce({
        IdentityId: "us-east-1:identity-id-123",
      })
      .mockResolvedValueOnce({
        Credentials: {
          SecretKey: "SECRET",
          SessionToken: "TOKEN",
          Expiration: new Date(),
        },
      });

    await expect(getAwsCredentials(testConfig, "test-id-token")).rejects.toThrow("Incomplete credentials");
  });

  it("throws when credentials are incomplete (missing SecretKey)", async () => {
    mockSend
      .mockResolvedValueOnce({
        IdentityId: "us-east-1:identity-id-123",
      })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: "AKID",
          SessionToken: "TOKEN",
          Expiration: new Date(),
        },
      });

    await expect(getAwsCredentials(testConfig, "test-id-token")).rejects.toThrow("Incomplete credentials");
  });

  it("throws when credentials are incomplete (missing SessionToken)", async () => {
    mockSend
      .mockResolvedValueOnce({
        IdentityId: "us-east-1:identity-id-123",
      })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: "AKID",
          SecretKey: "SECRET",
          Expiration: new Date(),
        },
      });

    await expect(getAwsCredentials(testConfig, "test-id-token")).rejects.toThrow("Incomplete credentials");
  });

  it("throws when Credentials object is missing", async () => {
    mockSend
      .mockResolvedValueOnce({
        IdentityId: "us-east-1:identity-id-123",
      })
      .mockResolvedValueOnce({
        Credentials: undefined,
      });

    await expect(getAwsCredentials(testConfig, "test-id-token")).rejects.toThrow("Incomplete credentials");
  });
});
