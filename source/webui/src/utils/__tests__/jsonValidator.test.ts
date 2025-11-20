// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { isValidJSON } from "../jsonValidator";

describe("isValidJSON", () => {
  it("should return true for empty string", () => {
    expect(isValidJSON("")).toBe(true);
  });

  it("should return true for whitespace-only string", () => {
    expect(isValidJSON("   ")).toBe(true);
  });

  it("should return true for valid JSON object", () => {
    expect(isValidJSON('{"key": "value"}')).toBe(true);
  });

  it("should return true for valid JSON array", () => {
    expect(isValidJSON("[1, 2, 3]")).toBe(true);
  });

  it("should return false for invalid JSON", () => {
    expect(isValidJSON('{"key": value}')).toBe(false);
  });

  it("should return false for malformed JSON", () => {
    expect(isValidJSON('{"key":')).toBe(false);
  });
});
