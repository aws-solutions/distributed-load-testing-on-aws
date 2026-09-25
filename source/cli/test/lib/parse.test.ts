// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parsePositiveInt } from "../../src/lib/parse.js";

describe("parsePositiveInt", () => {
  it("parses a valid positive integer", () => {
    expect(parsePositiveInt("1", "--flag")).toBe(1);
    expect(parsePositiveInt("42", "--flag")).toBe(42);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePositiveInt("  7  ", "--flag")).toBe(7);
  });

  it("rejects zero", () => {
    expect(() => parsePositiveInt("0", "--concurrency")).toThrow("--concurrency must be a positive integer");
  });

  it("rejects negative numbers", () => {
    expect(() => parsePositiveInt("-3", "--limit")).toThrow("--limit must be a positive integer");
  });

  it("rejects decimals", () => {
    expect(() => parsePositiveInt("3.5", "--task-count")).toThrow("--task-count must be a positive integer");
  });

  it("rejects non-numeric input", () => {
    expect(() => parsePositiveInt("abc", "--limit")).toThrow("--limit must be a positive integer");
  });

  it("rejects an empty string", () => {
    expect(() => parsePositiveInt("", "--flag")).toThrow("--flag must be a positive integer");
  });

  it("names the offending flag in the error message", () => {
    expect(() => parsePositiveInt("x", "--my-flag")).toThrow("--my-flag must be a positive integer");
  });
});
