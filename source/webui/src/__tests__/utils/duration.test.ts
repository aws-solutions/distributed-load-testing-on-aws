// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  fromSeconds,
  isDurationUnit,
  isPositiveInteger,
  isPositiveNumber,
  parseStoredDuration,
  serializeDuration,
  toSeconds,
} from "../../pages/scenarios/utils/duration";

describe("parseStoredDuration", () => {
  it.each([
    ["30s", { value: "30", unit: "seconds" }],
    ["2m", { value: "2", unit: "minutes" }],
    ["1h", { value: "1", unit: "hours" }],
    [90, { value: "90", unit: "seconds" }],
    [7200, { value: "2", unit: "hours" }],
  ])("parses %s", (stored, duration) => {
    expect(parseStoredDuration(stored)).toEqual(duration);
  });

  it.each([undefined, null, "", "1h 30m", "5", "5minutes", " 5m", "2d", -1, 1.5, {}])(
    "leaves unsupported value %s blank",
    (stored) => {
      expect(parseStoredDuration(stored)).toBeUndefined();
    }
  );
});

describe("serializeDuration", () => {
  it("serializes each supported unit", () => {
    expect(serializeDuration("30", "seconds")).toBe("30s");
    expect(serializeDuration("2", "minutes")).toBe("2m");
    expect(serializeDuration("1", "hours")).toBe("1h");
  });
});

describe("isDurationUnit", () => {
  it.each(["seconds", "minutes", "hours"])("accepts %s", (unit) => {
    expect(isDurationUnit(unit)).toBe(true);
  });

  it.each(["days", "m", ""])("rejects %s", (unit) => {
    expect(isDurationUnit(unit)).toBe(false);
  });
});

describe("toSeconds", () => {
  it("passes seconds through", () => {
    expect(toSeconds("30", "seconds")).toBe(30);
  });

  it("multiplies minutes", () => {
    expect(toSeconds("2", "minutes")).toBe(120);
  });

  it("multiplies hours", () => {
    expect(toSeconds("2", "hours")).toBe(7200);
  });

  it("returns NaN for a non-numeric value", () => {
    expect(toSeconds("abc", "minutes")).toBeNaN();
  });

  it("rejects an unrecognised unit instead of coercing it", () => {
    // @ts-expect-error DurationUnit rejects values outside the supported unit set.
    expect(toSeconds("2", "fortnights")).toBeNaN();
  });
});

describe("fromSeconds", () => {
  it("prefers hours when the value divides exactly", () => {
    expect(fromSeconds(7200)).toEqual({ value: "2", unit: "hours" });
  });

  it("prefers minutes when hours would lose precision", () => {
    expect(fromSeconds(120)).toEqual({ value: "2", unit: "minutes" });
    expect(fromSeconds(5400)).toEqual({ value: "90", unit: "minutes" });
  });

  it("falls back to seconds when minutes would lose precision", () => {
    expect(fromSeconds(90)).toEqual({ value: "90", unit: "seconds" });
  });

  it("keeps sub-minute values in seconds", () => {
    expect(fromSeconds(45)).toEqual({ value: "45", unit: "seconds" });
  });

  it("does not report zero as minutes", () => {
    expect(fromSeconds(0)).toEqual({ value: "0", unit: "seconds" });
  });

  it("round-trips the 24 hour cap as hours", () => {
    expect(fromSeconds(86400)).toEqual({ value: "24", unit: "hours" });
    expect(toSeconds("24", "hours")).toBe(86400);
  });
});

describe("isPositiveInteger", () => {
  it.each(["1", "86400", " 42 "])("accepts %s", (value) => {
    expect(isPositiveInteger(value)).toBe(true);
  });

  it.each(["", "0", "-1", "3.5", "1e3", "abc"])("rejects %s", (value) => {
    expect(isPositiveInteger(value)).toBe(false);
  });
});

describe("isPositiveNumber", () => {
  it.each(["1", "0.5", " 2.25 ", "86400"])("accepts %s", (value) => {
    expect(isPositiveNumber(value)).toBe(true);
  });

  it.each(["", "0", "-1", "-0.5", "abc", "Infinity"])("rejects %s", (value) => {
    expect(isPositiveNumber(value)).toBe(false);
  });
});
