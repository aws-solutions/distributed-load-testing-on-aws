// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

import {
  loadCredentials,
  saveCredentials,
  credentialsExist,
  isTokenExpired,
  isAwsCredentialExpired,
  clearCredentials,
  type DltCredentials,
} from "../../src/lib/credentials.js";

const makeCreds = (overrides?: Partial<DltCredentials>): DltCredentials => ({
  authMode: "browser",
  idToken: "id-tok",
  accessToken: "access-tok",
  refreshToken: "refresh-tok",
  tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
  awsAccessKeyId: "AKIA...",
  awsSecretAccessKey: "secret",
  awsSessionToken: "session",
  awsCredentialExpiry: new Date(Date.now() + 3600_000).toISOString(),
  ...overrides,
});

describe("credentials", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves and loads credentials", () => {
    expect(credentialsExist()).toBe(false);
    const creds = makeCreds();
    saveCredentials(creds);
    expect(credentialsExist()).toBe(true);
    const loaded = loadCredentials();
    expect(loaded.accessToken).toBe("access-tok");
    expect(loaded.authMode).toBe("browser");
  });

  it("throws when no credentials exist", () => {
    expect(() => loadCredentials()).toThrow("Credentials not found");
  });

  it("clears credentials", () => {
    saveCredentials(makeCreds());
    expect(credentialsExist()).toBe(true);
    clearCredentials();
    expect(credentialsExist()).toBe(false);
  });

  it("defaults authMode to browser for legacy credentials", () => {
    // Simulate credentials saved without authMode (pre-headless)
    const legacyCreds = {
      idToken: "id-tok",
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      awsAccessKeyId: "AKIA...",
      awsSecretAccessKey: "secret",
      awsSessionToken: "session",
      awsCredentialExpiry: new Date(Date.now() + 3600_000).toISOString(),
    };
    vol.mkdirSync("/home/testuser/.dlt", { recursive: true });
    vol.writeFileSync("/home/testuser/.dlt/credentials.json", JSON.stringify(legacyCreds));
    const loaded = loadCredentials();
    expect(loaded.authMode).toBe("browser");
  });

  it("saves and loads IAM mode credentials (no tokens)", () => {
    const iamCreds: DltCredentials = {
      authMode: "iam",
      awsAccessKeyId: "ASIA...",
      awsSecretAccessKey: "secret-iam",
      awsSessionToken: "session-iam",
      awsCredentialExpiry: new Date(Date.now() + 3600_000).toISOString(),
    };
    saveCredentials(iamCreds);
    const loaded = loadCredentials();
    expect(loaded.authMode).toBe("iam");
    expect(loaded.idToken).toBeUndefined();
    expect(loaded.accessToken).toBeUndefined();
    expect(loaded.refreshToken).toBeUndefined();
    expect(loaded.awsAccessKeyId).toBe("ASIA...");
  });

  it("saves and loads SRP mode credentials", () => {
    const srpCreds = makeCreds({ authMode: "srp" });
    saveCredentials(srpCreds);
    const loaded = loadCredentials();
    expect(loaded.authMode).toBe("srp");
    expect(loaded.idToken).toBe("id-tok");
  });

  describe("isTokenExpired", () => {
    it("returns false for future expiry", () => {
      const creds = makeCreds({
        tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(isTokenExpired(creds)).toBe(false);
    });

    it("returns true for past expiry", () => {
      const creds = makeCreds({
        tokenExpiry: new Date(Date.now() - 1000).toISOString(),
      });
      expect(isTokenExpired(creds)).toBe(true);
    });

    it("returns true within 60-second safety margin", () => {
      const creds = makeCreds({
        tokenExpiry: new Date(Date.now() + 30_000).toISOString(),
      });
      expect(isTokenExpired(creds)).toBe(true);
    });

    it("returns true when tokenExpiry is undefined (IAM mode)", () => {
      const creds: DltCredentials = {
        authMode: "iam",
        awsAccessKeyId: "ASIA...",
        awsSecretAccessKey: "secret",
        awsSessionToken: "session",
        awsCredentialExpiry: new Date(Date.now() + 3600_000).toISOString(),
      };
      expect(isTokenExpired(creds)).toBe(true);
    });
  });

  describe("isAwsCredentialExpired", () => {
    it("returns false for future expiry", () => {
      const creds = makeCreds({
        awsCredentialExpiry: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(isAwsCredentialExpired(creds)).toBe(false);
    });

    it("returns true for past expiry", () => {
      const creds = makeCreds({
        awsCredentialExpiry: new Date(Date.now() - 1000).toISOString(),
      });
      expect(isAwsCredentialExpired(creds)).toBe(true);
    });
  });
});
