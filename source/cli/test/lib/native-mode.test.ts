// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { buildNativeRunMode, parseDurationToSeconds } from "../../src/lib/native-mode.js";

describe("parseDurationToSeconds", () => {
  it("treats a bare number as seconds", () => {
    expect(parseDurationToSeconds("90", "--max-test-duration")).toBe(90);
  });

  it("applies the s/m/h/d unit suffixes", () => {
    expect(parseDurationToSeconds("30s", "--x")).toBe(30);
    expect(parseDurationToSeconds("15m", "--x")).toBe(900);
    expect(parseDurationToSeconds("2h", "--x")).toBe(7200);
    expect(parseDurationToSeconds("1d", "--x")).toBe(86400);
  });

  it("trims surrounding whitespace", () => {
    expect(parseDurationToSeconds("  10m ", "--x")).toBe(600);
  });

  it("rejects fractional and malformed durations with the flag name", () => {
    expect(() => parseDurationToSeconds("1.5m", "--max-test-duration")).toThrow(/--max-test-duration/);
    expect(() => parseDurationToSeconds("10x", "--max-test-duration")).toThrow(/--max-test-duration/);
    expect(() => parseDurationToSeconds("", "--max-test-duration")).toThrow(/--max-test-duration/);
  });
});

describe("buildNativeRunMode", () => {
  it("requires --max-test-duration", () => {
    expect(() => buildNativeRunMode({})).toThrow(/--max-test-duration is required/);
  });

  it("builds a native config with only the safety timeout", () => {
    expect(buildNativeRunMode({ maxTestDuration: "20m" })).toEqual({
      maxTestDurationSeconds: 1200,
    });
  });

  it("applies the 24h duration ceiling", () => {
    expect(() => buildNativeRunMode({ maxTestDuration: "48h" })).toThrow(/--max-test-duration/);
  });
});
