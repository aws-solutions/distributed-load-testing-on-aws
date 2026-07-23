// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseSafeJson } from "../src/json";

describe("json", () => {
  describe("parseSafeJson", () => {
    it("should parse valid JSON string", () => {
      const result = parseSafeJson<{ name: string }>('{"name": "test"}');
      expect(result).toEqual({ name: "test" });
    });

    it("should parse JSON arrays", () => {
      const result = parseSafeJson<number[]>("[1, 2, 3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("should parse JSON primitives", () => {
      expect(parseSafeJson<number>("42")).toBe(42);
      expect(parseSafeJson<string>('"hello"')).toBe("hello");
      expect(parseSafeJson<boolean>("true")).toBe(true);
      expect(parseSafeJson<null>("null")).toBe(null);
    });

    it("should parse nested objects", () => {
      const json = '{"outer": {"inner": "value"}, "arr": [1, 2]}';
      const result = parseSafeJson<{ outer: { inner: string }; arr: number[] }>(json);
      expect(result.outer.inner).toBe("value");
      expect(result.arr).toEqual([1, 2]);
    });

    it("should throw Error with message for invalid JSON", () => {
      expect(() => parseSafeJson("not valid json")).toThrow("Invalid JSON payload");
    });

    it("should throw Error for empty string", () => {
      expect(() => parseSafeJson("")).toThrow("Invalid JSON payload");
    });

    it("should throw Error for malformed JSON", () => {
      expect(() => parseSafeJson("{key: value}")).toThrow("Invalid JSON payload");
    });

    it("should throw Error for truncated JSON", () => {
      expect(() => parseSafeJson('{"name": ')).toThrow("Invalid JSON payload");
    });
  });
});
