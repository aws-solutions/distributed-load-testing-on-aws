// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseDurationToSeconds } from "../../src/lib/duration.js";

describe("parseDurationToSeconds", () => {
  it("treats a bare number as seconds and applies unit suffixes", () => {
    expect(parseDurationToSeconds("90", "--x")).toBe(90);
    expect(parseDurationToSeconds("30s", "--x")).toBe(30);
    expect(parseDurationToSeconds("15m", "--x")).toBe(900);
    expect(parseDurationToSeconds("2h", "--x")).toBe(7200);
    expect(parseDurationToSeconds("1d", "--x")).toBe(86400);
  });

  it("rejects fractional and malformed values with the flag name", () => {
    expect(() => parseDurationToSeconds("1.5m", "--max-test-duration")).toThrow(/--max-test-duration/);
    expect(() => parseDurationToSeconds("10x", "--max-test-duration")).toThrow(/--max-test-duration/);
    expect(() => parseDurationToSeconds("", "--max-test-duration")).toThrow(/--max-test-duration/);
  });

  it("accepts a value at the max bound", () => {
    expect(parseDurationToSeconds("24h", "--max-test-duration", 86400)).toBe(86400);
    expect(parseDurationToSeconds("86400", "--max-test-duration", 86400)).toBe(86400);
  });

  it("rejects a value above the max bound with a unit-aware message", () => {
    expect(() => parseDurationToSeconds("48h", "--max-test-duration", 86400)).toThrow(
      "--max-test-duration must not exceed 24h (86400 seconds)"
    );
    expect(() => parseDurationToSeconds("90000", "--max-test-duration", 86400)).toThrow(/must not exceed 24h/);
  });

  it("does not enforce a bound when maxSeconds is omitted", () => {
    expect(parseDurationToSeconds("48h", "--x")).toBe(172800);
  });
});
