// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

// Mock fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

import {
  extractRegionFromUserPoolId,
  parseAwsExportsFile,
  loadConfig,
  saveConfig,
  configExists,
} from "../../src/lib/config.js";

describe("config", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("extractRegionFromUserPoolId", () => {
    it("extracts region from valid pool ID", () => {
      expect(extractRegionFromUserPoolId("us-east-1_AbCdEfG")).toBe("us-east-1");
    });

    it("extracts region with complex region name", () => {
      expect(extractRegionFromUserPoolId("ap-southeast-2_XyZ123")).toBe("ap-southeast-2");
    });

    it("throws on invalid format", () => {
      expect(() => extractRegionFromUserPoolId("invalid")).toThrow("Invalid UserPoolId format");
    });

    it("throws on empty string", () => {
      expect(() => extractRegionFromUserPoolId("")).toThrow("Invalid UserPoolId format");
    });
  });

  describe("parseAwsExportsFile", () => {
    it("parses valid aws-exports.json", () => {
      const exports = {
        UserPoolId: "us-east-1_AbCdEfG",
        PoolClientId: "client123",
        IdentityPoolId: "us-east-1:aaaa-bbbb",
        UserPoolDomain: "dlt-test.auth.us-east-1.amazoncognito.com",
        ApiEndpoint: "https://api.example.com/prod",
        UserFilesBucket: "bucket-name",
      };
      vol.fromJSON({ "/tmp/exports.json": JSON.stringify(exports) });

      const config = parseAwsExportsFile("/tmp/exports.json");
      expect(config.apiEndpoint).toBe("https://api.example.com/prod");
      expect(config.userPoolId).toBe("us-east-1_AbCdEfG");
      expect(config.userPoolClientId).toBe("client123");
      expect(config.identityPoolId).toBe("us-east-1:aaaa-bbbb");
      expect(config.userPoolDomain).toBe("dlt-test.auth.us-east-1.amazoncognito.com");
      expect(config.region).toBe("us-east-1");
    });

    it("throws on missing required field", () => {
      const exports = {
        UserPoolId: "us-east-1_AbCdEfG",
        PoolClientId: "client123",
      };
      vol.fromJSON({ "/tmp/exports.json": JSON.stringify(exports) });

      expect(() => parseAwsExportsFile("/tmp/exports.json")).toThrow('Missing required field "IdentityPoolId"');
    });

    it("throws on invalid JSON", () => {
      vol.fromJSON({ "/tmp/exports.json": "not json{" });
      expect(() => parseAwsExportsFile("/tmp/exports.json")).toThrow("Failed to parse JSON");
    });
  });

  describe("saveConfig / loadConfig / configExists", () => {
    it("saves and loads config", () => {
      expect(configExists()).toBe(false);

      const config = {
        apiEndpoint: "https://api.example.com",
        userPoolId: "us-east-1_Abc",
        userPoolClientId: "client",
        identityPoolId: "us-east-1:pool",
        userPoolDomain: "domain.auth.us-east-1.amazoncognito.com",
        region: "us-east-1",
      };

      saveConfig(config);
      expect(configExists()).toBe(true);

      const loaded = loadConfig();
      expect(loaded).toEqual(config);
    });

    it("throws when config does not exist", () => {
      expect(() => loadConfig()).toThrow("Configuration not found");
    });
  });
});
