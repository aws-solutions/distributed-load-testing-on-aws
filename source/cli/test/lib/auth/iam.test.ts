// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFromNodeProviderChain = vi.fn();

vi.mock("@aws-sdk/credential-providers", () => ({
  fromNodeProviderChain: () => mockFromNodeProviderChain,
}));

import { resolveIamCredentials } from "../../../src/lib/auth/iam.js";

describe("iam - resolveIamCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves credentials successfully", async () => {
    const expDate = new Date("2025-06-01T00:00:00Z");
    mockFromNodeProviderChain.mockResolvedValue({
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      sessionToken: "TOKEN",
      expiration: expDate,
    });

    const result = await resolveIamCredentials();
    expect(result.accessKeyId).toBe("AKID");
    expect(result.secretAccessKey).toBe("SECRET");
    expect(result.sessionToken).toBe("TOKEN");
    expect(result.expiration).toBe(expDate);
  });

  it("defaults sessionToken to empty string when undefined", async () => {
    mockFromNodeProviderChain.mockResolvedValue({
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    });

    const result = await resolveIamCredentials();
    expect(result.sessionToken).toBe("");
  });

  it("defaults expiration to ~1 hour when undefined", async () => {
    const before = Date.now();
    mockFromNodeProviderChain.mockResolvedValue({
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    });

    const result = await resolveIamCredentials();
    const after = Date.now();
    const expTime = result.expiration.getTime();
    expect(expTime).toBeGreaterThanOrEqual(before + 3_500_000);
    expect(expTime).toBeLessThanOrEqual(after + 3_700_000);
  });

  it("throws when provider chain fails", async () => {
    mockFromNodeProviderChain.mockRejectedValue(new Error("No credentials found"));

    await expect(resolveIamCredentials()).rejects.toThrow("Failed to resolve AWS credentials");
  });

  it("throws when accessKeyId is missing", async () => {
    mockFromNodeProviderChain.mockResolvedValue({
      secretAccessKey: "SECRET",
    });

    await expect(resolveIamCredentials()).rejects.toThrow("Could not resolve AWS credentials");
  });

  it("throws when secretAccessKey is missing", async () => {
    mockFromNodeProviderChain.mockResolvedValue({
      accessKeyId: "AKID",
    });

    await expect(resolveIamCredentials()).rejects.toThrow("Could not resolve AWS credentials");
  });
});
