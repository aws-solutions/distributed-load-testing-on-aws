// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const mockLoadConfig = vi.fn(() => ({
  apiEndpoint: "https://api.example.com/prod",
  userPoolId: "us-east-1_abc",
  userPoolClientId: "client",
  identityPoolId: "us-east-1:pool",
  userPoolDomain: "domain.auth.amazoncognito.com",
  region: "us-east-1",
}));

const mockSaveCredentials = vi.fn();

vi.mock("../../src/lib/config.js", () => ({
  loadConfig: () => mockLoadConfig(),
}));

vi.mock("../../src/lib/credentials.js", () => ({
  saveCredentials: (c: unknown) => mockSaveCredentials(c),
}));

const mockGeneratePkceChallenge = vi.fn(() => ({
  codeVerifier: "verifier",
  codeChallenge: "challenge",
}));
const mockBuildAuthorizeUrl = vi.fn(() => "https://auth.example.com/authorize");
const mockStartCallbackServer = vi.fn();
const mockExchangeCodeForTokens = vi.fn();
const mockGetAwsCredentials = vi.fn();
const mockSrpAuthenticate = vi.fn();
const mockResolveIamCredentials = vi.fn();

vi.mock("../../src/lib/auth/index.js", () => ({
  generatePkceChallenge: () => mockGeneratePkceChallenge(),
  buildAuthorizeUrl: (...args: unknown[]) => mockBuildAuthorizeUrl(...args),
  startCallbackServer: (...args: unknown[]) => mockStartCallbackServer(...args),
  exchangeCodeForTokens: (...args: unknown[]) => mockExchangeCodeForTokens(...args),
  getAwsCredentials: (...args: unknown[]) => mockGetAwsCredentials(...args),
  srpAuthenticate: (...args: unknown[]) => mockSrpAuthenticate(...args),
  resolveIamCredentials: () => mockResolveIamCredentials(),
}));

vi.mock("open", () => ({
  default: vi.fn(),
}));

vi.mock("../../src/lib/error-handler.js", () => ({
  withErrorHandler: (fn: Function) => fn,
}));

import { registerLoginCommand } from "../../src/commands/login.js";

describe("login command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program);
    return program;
  }

  it("registers the login command", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "login");
    expect(cmd).toBeDefined();
  });

  describe("--iam mode", () => {
    it("resolves IAM credentials and saves them", async () => {
      mockResolveIamCredentials.mockResolvedValue({
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        sessionToken: "TOKEN",
        expiration: new Date("2025-01-01T00:00:00Z"),
      });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "login", "--iam"]);

      expect(mockResolveIamCredentials).toHaveBeenCalled();
      expect(mockSaveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          authMode: "iam",
          awsAccessKeyId: "AKID",
        })
      );
      consoleSpy.mockRestore();
    });
  });

  describe("--srp mode", () => {
    it("throws when --username is missing", async () => {
      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "login", "--srp"])).rejects.toThrow("--username is required");
    });

    it("throws when password is missing", async () => {
      const origPw = process.env["DLT_PASSWORD"];
      delete process.env["DLT_PASSWORD"];

      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "login", "--srp", "-u", "user"])).rejects.toThrow(
        "Password is required"
      );

      if (origPw !== undefined) process.env["DLT_PASSWORD"] = origPw;
    });

    it("authenticates via SRP with username/password", async () => {
      mockSrpAuthenticate.mockResolvedValue({
        idToken: "id-tok",
        accessToken: "access-tok",
        refreshToken: "refresh-tok",
        expiresIn: 3600,
      });
      mockGetAwsCredentials.mockResolvedValue({
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        sessionToken: "TOKEN",
        expiration: new Date("2025-01-01T00:00:00Z"),
      });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "login", "--srp", "-u", "testuser", "-p", "testpass"]);

      expect(mockSrpAuthenticate).toHaveBeenCalled();
      expect(mockGetAwsCredentials).toHaveBeenCalled();
      expect(mockSaveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          authMode: "srp",
          idToken: "id-tok",
        })
      );
      consoleSpy.mockRestore();
    });
  });

  describe("--srp and --iam mutually exclusive", () => {
    it("throws when both flags provided", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "dlt", "login", "--srp", "--iam", "-u", "u", "-p", "p"])
      ).rejects.toThrow("mutually exclusive");
    });
  });

  describe("browser mode (default)", () => {
    it("starts callback server and opens browser", async () => {
      mockStartCallbackServer.mockResolvedValue({
        code: "auth-code",
        server: { close: vi.fn() },
      });
      mockExchangeCodeForTokens.mockResolvedValue({
        id_token: "id-tok",
        access_token: "access-tok",
        refresh_token: "refresh-tok",
        expires_in: 3600,
      });
      mockGetAwsCredentials.mockResolvedValue({
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        sessionToken: "TOKEN",
        expiration: new Date("2025-01-01T00:00:00Z"),
      });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "login"]);

      expect(mockStartCallbackServer).toHaveBeenCalled();
      expect(mockExchangeCodeForTokens).toHaveBeenCalled();
      expect(mockGetAwsCredentials).toHaveBeenCalled();
      expect(mockSaveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          authMode: "browser",
          idToken: "id-tok",
        })
      );
      consoleSpy.mockRestore();
    });

    it("falls back to port 3000 when port 7521 is in use", async () => {
      const eaddrinuseError = Object.assign(
        new Error("listen EADDRINUSE: address already in use 127.0.0.1:7521"),
        { code: "EADDRINUSE" }
      );
      mockStartCallbackServer
        .mockRejectedValueOnce(eaddrinuseError)
        .mockResolvedValueOnce({
          code: "auth-code",
          server: { close: vi.fn() },
        });
      mockExchangeCodeForTokens.mockResolvedValue({
        id_token: "id-tok",
        access_token: "access-tok",
        refresh_token: "refresh-tok",
        expires_in: 3600,
      });
      mockGetAwsCredentials.mockResolvedValue({
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        sessionToken: "TOKEN",
        expiration: new Date("2025-01-01T00:00:00Z"),
      });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "login"]);

      expect(mockStartCallbackServer).toHaveBeenCalledTimes(2);
      expect(mockStartCallbackServer).toHaveBeenNthCalledWith(1, 7521);
      expect(mockStartCallbackServer).toHaveBeenNthCalledWith(2, 3000);
      expect(mockExchangeCodeForTokens).toHaveBeenCalledWith(
        expect.anything(),
        "auth-code",
        "verifier",
        "http://localhost:3000/callback"
      );
      expect(mockSaveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ authMode: "browser" })
      );
      consoleSpy.mockRestore();
    });

    it("throws when all fallback ports are in use", async () => {
      const makeEaddrinuse = (port: number) =>
        Object.assign(
          new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`),
          { code: "EADDRINUSE" }
        );
      mockStartCallbackServer
        .mockRejectedValueOnce(makeEaddrinuse(7521))
        .mockRejectedValueOnce(makeEaddrinuse(3000));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "login"])).rejects.toThrow(
        "Failed to start callback server"
      );

      expect(mockStartCallbackServer).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });
  });
});
