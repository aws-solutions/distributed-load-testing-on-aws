// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { isValidUri } from "../../utils/uriValidator";

describe("isValidUri", () => {
  describe("valid URIs", () => {
    test.each([
      ["http://www.example.com"],
      ["https://www.example.com"],
      ["https://example.com/path/to/resource"],
      ["https://example.com:8080"],
      ["https://example.com:8080/path?query=value"],
      ["https://example.com/path?query=value&other=123#fragment"],
      ["http://localhost"],
      ["http://localhost:3000"],
      ["http://192.168.1.1"],
      ["http://192.168.1.1:8080/api"],
      ["https://sub.domain.example.com"],
      ["ftp://files.example.com/resource"],
      ["ws://websocket.example.com"],
      ["wss://secure-websocket.example.com/path"],
      ["mqtt://broker.example.com"],
      ["ssh://user@host.example.com"],
      ["https://example.com/path%20with%20spaces"],
    ])("accepts %s", (uri) => {
      const result = isValidUri(uri);
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
    });
  });

  describe("invalid URIs", () => {
    test("rejects empty string", () => {
      const result = isValidUri("");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("HTTP endpoint is required");
    });

    test("rejects whitespace-only string", () => {
      const result = isValidUri("   ");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("HTTP endpoint is required");
    });

    test("rejects plain text without scheme", () => {
      const result = isValidUri("example.com");
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain("valid format");
    });

    test("rejects random text", () => {
      const result = isValidUri("not a url at all");
      expect(result.isValid).toBe(false);
    });

    test("rejects missing host after scheme", () => {
      // Note: URL constructor behavior — "http://" alone throws
      const result = isValidUri("http://");
      expect(result.isValid).toBe(false);
    });

    test("rejects scheme only", () => {
      const result = isValidUri("https:");
      expect(result.isValid).toBe(false);
    });

    test("rejects partial scheme", () => {
      const result = isValidUri("://missing-scheme");
      expect(result.isValid).toBe(false);
    });

    test("rejects URI exceeding max length", () => {
      const longUri = "https://example.com/" + "a".repeat(2048);
      const result = isValidUri(longUri);
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain("2048");
    });
  });
});