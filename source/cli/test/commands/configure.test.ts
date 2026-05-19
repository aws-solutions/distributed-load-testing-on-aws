// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const mockParseAwsExportsFile = vi.fn();
const mockSaveConfig = vi.fn();
const mockConfigExists = vi.fn(() => false);
const mockExtractRegionFromUserPoolId = vi.fn(() => "us-east-1");

vi.mock("../../src/lib/config.js", () => ({
  parseAwsExportsFile: (...args: unknown[]) => mockParseAwsExportsFile(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  configExists: (...args: unknown[]) => mockConfigExists(...args),
  extractRegionFromUserPoolId: (...args: unknown[]) => mockExtractRegionFromUserPoolId(...args),
}));

vi.mock("../../src/lib/error-handler.js", () => ({
  withErrorHandler: (fn: Function) => fn,
}));

const mockConfirmOverwrite = vi.fn();

vi.mock("../../src/lib/prompt.js", () => ({
  confirmOverwrite: (...args: unknown[]) => mockConfirmOverwrite(...args),
}));

vi.mock("../../src/lib/paths.js", () => ({
  DLT_DIR: "/home/testuser/.dlt",
}));

import { registerConfigureCommand } from "../../src/commands/configure.js";

describe("configure command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerConfigureCommand(program);
    return program;
  }

  it("registers the configure command", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "configure");
    expect(cmd).toBeDefined();
  });

  it("imports config from file with --from-file", async () => {
    mockParseAwsExportsFile.mockReturnValue({
      apiEndpoint: "https://api.example.com",
      userPoolId: "us-east-1_abc",
      userPoolClientId: "client",
      identityPoolId: "us-east-1:pool",
      userPoolDomain: "domain.auth.us-east-1.amazoncognito.com",
      region: "us-east-1",
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "dlt", "configure", "--from-file", "/path/to/exports.json"]);

    expect(mockParseAwsExportsFile).toHaveBeenCalledWith("/path/to/exports.json");
    expect(mockSaveConfig).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("accepts inline options", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync([
      "node",
      "dlt",
      "configure",
      "--api-endpoint",
      "https://api.example.com",
      "--user-pool-id",
      "us-east-1_abc",
      "--user-pool-client-id",
      "client",
      "--identity-pool-id",
      "us-east-1:pool",
      "--user-pool-domain",
      "domain.auth.us-east-1.amazoncognito.com",
      "--region",
      "us-west-2",
    ]);

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        apiEndpoint: "https://api.example.com",
        userPoolId: "us-east-1_abc",
        userPoolClientId: "client",
        identityPoolId: "us-east-1:pool",
        userPoolDomain: "domain.auth.us-east-1.amazoncognito.com",
        region: "us-west-2",
      })
    );
    consoleSpy.mockRestore();
  });

  it("infers region from user pool id when not specified", async () => {
    mockExtractRegionFromUserPoolId.mockReturnValue("eu-west-1");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync([
      "node",
      "dlt",
      "configure",
      "--api-endpoint",
      "https://api.example.com",
      "--user-pool-id",
      "eu-west-1_abc",
      "--user-pool-client-id",
      "client",
      "--identity-pool-id",
      "eu-west-1:pool",
      "--user-pool-domain",
      "domain.auth.eu-west-1.amazoncognito.com",
    ]);

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "eu-west-1",
      })
    );
    consoleSpy.mockRestore();
  });

  it("accepts --scenarios-bucket option", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync([
      "node",
      "dlt",
      "configure",
      "--api-endpoint",
      "https://api.example.com",
      "--user-pool-id",
      "us-east-1_abc",
      "--user-pool-client-id",
      "client",
      "--identity-pool-id",
      "us-east-1:pool",
      "--user-pool-domain",
      "domain.auth.amazoncognito.com",
      "--scenarios-bucket",
      "my-bucket",
    ]);

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        scenariosBucket: "my-bucket",
      })
    );
    consoleSpy.mockRestore();
  });

  describe("overwrite protection", () => {
    const inlineArgs = [
      "node",
      "dlt",
      "configure",
      "--api-endpoint",
      "https://api.example.com",
      "--user-pool-id",
      "us-east-1_abc",
      "--user-pool-client-id",
      "client",
      "--identity-pool-id",
      "us-east-1:pool",
      "--user-pool-domain",
      "domain.auth.us-east-1.amazoncognito.com",
    ];

    it("calls confirmOverwrite before saving config", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(inlineArgs);

      expect(mockConfirmOverwrite).toHaveBeenCalledWith("/home/testuser/.dlt/config.json", false);
      expect(mockSaveConfig).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("passes force=true to confirmOverwrite when --force is used", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([...inlineArgs, "--force"]);

      expect(mockConfirmOverwrite).toHaveBeenCalledWith("/home/testuser/.dlt/config.json", true);
      expect(mockSaveConfig).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("does not save config when user declines overwrite", async () => {
      mockConfirmOverwrite.mockRejectedValue(new Error("Aborted: not overwriting existing file."));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await expect(program.parseAsync(inlineArgs)).rejects.toThrow("Aborted");

      expect(mockSaveConfig).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
