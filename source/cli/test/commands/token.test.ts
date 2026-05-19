// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const mockLoadCredentials = vi.fn();
const mockIsTokenExpired = vi.fn();
const mockApiCredentials = vi.fn();

vi.mock("../../src/lib/api-client.js", () => ({
  ApiClient: {
    create: vi.fn(async () => ({
      get: vi.fn(),
      post: vi.fn(),
      config: {
        apiEndpoint: "https://api.example.com/prod",
        userPoolId: "us-east-1_abc",
        userPoolClientId: "client",
        identityPoolId: "us-east-1:pool",
        userPoolDomain: "domain.auth.amazoncognito.com",
        region: "us-east-1",
      },
      region: "us-east-1",
      get credentials() {
        return mockApiCredentials();
      },
    })),
  },
}));

vi.mock("../../src/lib/credentials.js", () => ({
  loadCredentials: () => mockLoadCredentials(),
  isTokenExpired: (c: unknown) => mockIsTokenExpired(c),
}));

vi.mock("../../src/lib/error-handler.js", () => ({
  withErrorHandler: (fn: Function) => fn,
}));

vi.mock("../../src/lib/output.js", () => ({
  printResult: vi.fn(),
  formatOption: vi.fn(() => {
    const { Option } = require("commander");
    return new Option("--format <format>", "Output format").default("table");
  }),
}));

import { registerTokenCommand } from "../../src/commands/token.js";

describe("token command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerTokenCommand(program);
    return program;
  }

  it("registers the token command with subcommands", () => {
    const program = createProgram();
    const token = program.commands.find((c) => c.name() === "token");
    expect(token).toBeDefined();
    const subcmds = token!.commands.map((c) => c.name());
    expect(subcmds).toContain("output");
    expect(subcmds).toContain("status");
  });

  describe("token output", () => {
    it("outputs access token by default", async () => {
      mockApiCredentials.mockReturnValue({
        authMode: "browser",
        accessToken: "my-access-token",
        idToken: "my-id-token",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "token", "output"]);

      expect(writeSpy).toHaveBeenCalledWith("my-access-token");
      writeSpy.mockRestore();
    });

    it("outputs id token with --type id", async () => {
      mockApiCredentials.mockReturnValue({
        authMode: "browser",
        accessToken: "my-access-token",
        idToken: "my-id-token",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "token", "output", "--type", "id"]);

      expect(writeSpy).toHaveBeenCalledWith("my-id-token");
      writeSpy.mockRestore();
    });

    it("throws for IAM mode", async () => {
      mockApiCredentials.mockReturnValue({
        authMode: "iam",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "token", "output"])).rejects.toThrow(
        "No Cognito tokens available in IAM mode"
      );
    });

    it("throws for unknown token type", async () => {
      mockApiCredentials.mockReturnValue({
        authMode: "browser",
        accessToken: "tok",
        idToken: "id",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      const program = createProgram();
      await expect(program.parseAsync(["node", "dlt", "token", "output", "--type", "unknown"])).rejects.toThrow(
        'Unknown token type: "unknown"'
      );
    });
  });

  describe("token status", () => {
    it("shows status for IAM mode", async () => {
      mockLoadCredentials.mockReturnValue({
        authMode: "iam",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
      });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "token", "status"]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("iam"));
      consoleSpy.mockRestore();
    });

    it("shows status for browser mode", async () => {
      mockLoadCredentials.mockReturnValue({
        authMode: "browser",
        accessToken: "tok",
        idToken: "id",
        refreshToken: "refresh",
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
      });
      mockIsTokenExpired.mockReturnValue(false);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "token", "status"]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("browser"));
      consoleSpy.mockRestore();
    });

    it("shows expired status for browser mode with no tokenExpiry", async () => {
      mockLoadCredentials.mockReturnValue({
        authMode: "browser",
        accessToken: "tok",
        idToken: "id",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
      });
      mockIsTokenExpired.mockReturnValue(true);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "token", "status"]);

      consoleSpy.mockRestore();
    });

    it("outputs JSON format", async () => {
      mockLoadCredentials.mockReturnValue({
        authMode: "iam",
        awsAccessKeyId: "AKID",
        awsSecretAccessKey: "SECRET",
        awsSessionToken: "TOKEN",
        awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
      });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "dlt", "token", "status", "--format", "json"]);

      consoleSpy.mockRestore();
    });
  });
});
