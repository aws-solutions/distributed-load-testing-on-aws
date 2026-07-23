// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import {
  getFileExtension,
  getBaselineDelta,
  getBaselineText,
  generateCSV,
  createBaselineComparisonCell,
  createBaselineCellWithStatus,
  createBaselineCell,
} from "../../pages/scenarios/utils";

describe("getFileExtension", () => {
  test("returns .jmx for jmeter", () => {
    expect(getFileExtension("jmeter")).toEqual([".jmx"]);
  });

  test("returns .ts and .js for k6", () => {
    expect(getFileExtension("k6")).toEqual([".ts", ".js"]);
  });

  test("returns .py for locust", () => {
    expect(getFileExtension("locust")).toEqual([".py"]);
  });

  test("returns empty array for unknown type", () => {
    expect(getFileExtension("unknown")).toEqual([]);
  });
});

describe("getBaselineDelta", () => {
  test("returns formatted positive delta", () => {
    expect(getBaselineDelta(150, 100)).toBe("+50.0%");
  });

  test("returns formatted negative delta", () => {
    expect(getBaselineDelta(50, 100)).toBe("-50.0%");
  });

  test("returns '--' when currentValue is undefined", () => {
    expect(getBaselineDelta(undefined, 100)).toBe("--");
  });

  test("returns '--' when baselineValue is undefined", () => {
    expect(getBaselineDelta(100, undefined)).toBe("--");
  });

  test("returns '--' when baselineValue is zero", () => {
    expect(getBaselineDelta(100, 0)).toBe("--");
  });
});

describe("getBaselineText", () => {
  test("returns formatted baseline text", () => {
    const result = getBaselineText(100, (val) => `${val}ms`);
    expect(result).toContain("Baseline (100ms)");
  });

  test("returns empty string when baselineValue is undefined", () => {
    expect(getBaselineText(undefined, (val) => `${val}ms`)).toBe("");
  });

  test("returns empty string when baselineValue is 0", () => {
    expect(getBaselineText(0, (val) => `${val}ms`)).toBe("");
  });
});

describe("generateCSV", () => {
  const columns = [
    { header: "Name", csvValue: (item: any) => item.name, csvBaselineValue: undefined },
    { header: "Count", csvValue: (item: any) => String(item.count), csvBaselineValue: (item: any) => `+${item.delta}%` },
  ] as any[];

  const data = [
    { name: "test-1", count: 100, delta: 5 },
    { name: "test-2", count: 200, delta: -3 },
  ];

  test("generates CSV without baseline columns", () => {
    const result = generateCSV(columns, data, false);
    const lines = result.split("\n");
    expect(lines[0]).toBe('"Name","Count"');
    expect(lines[1]).toBe('"test-1","100"');
    expect(lines[2]).toBe('"test-2","200"');
  });

  test("generates CSV with baseline columns", () => {
    const result = generateCSV(columns, data, true);
    const lines = result.split("\n");
    expect(lines[0]).toBe('"Name","Count","Count vs Baseline"');
    expect(lines[1]).toBe('"test-1","100","+5%"');
  });

  test("escapes quotes in values", () => {
    const cols = [{ header: "Val", csvValue: (item: any) => item.val }] as any[];
    const result = generateCSV(cols, [{ val: 'has "quotes"' }], false);
    expect(result).toContain('""quotes""');
  });
});

describe("createBaselineComparisonCell", () => {
  test("returns '--' when delta cannot be calculated", () => {
    expect(createBaselineComparisonCell(undefined, 100, "lower-is-better")).toBe("--");
  });

  test("returns StatusIndicator element with percentage for valid delta", () => {
    const result = createBaselineComparisonCell(150, 100, "lower-is-better") as any;
    expect(result).not.toBe("--");
    expect(result.props.children).toBe("+50.0%");
  });

  test("returns success status for lower-is-better when value decreased", () => {
    const result = createBaselineComparisonCell(50, 100, "lower-is-better") as any;
    expect(result.props.type).toBe("success");
  });

  test("returns warning status for lower-is-better when value increased", () => {
    const result = createBaselineComparisonCell(150, 100, "lower-is-better") as any;
    expect(result.props.type).toBe("warning");
  });

  test("returns success status for higher-is-better when value increased", () => {
    const result = createBaselineComparisonCell(150, 100, "higher-is-better") as any;
    expect(result.props.type).toBe("success");
  });

  test("shows formatted baseline value in actual displayMode", () => {
    const formatter = (val: number) => `${val}ms`;
    const result = createBaselineComparisonCell(150, 100, "lower-is-better", "actual", formatter) as any;
    expect(result.props.children).toBe("100ms");
  });
});

describe("createBaselineCellWithStatus", () => {
  test("returns formattedCurrent when hasBaseline is false", () => {
    expect(createBaselineCellWithStatus("100ms", 100, 80, false, "lower-is-better")).toBe("100ms");
  });

  test("returns formattedCurrent when delta cannot be calculated", () => {
    expect(createBaselineCellWithStatus("100ms", undefined, 80, true, "lower-is-better")).toBe("100ms");
  });

  test("returns element with percentage in default mode", () => {
    const result = createBaselineCellWithStatus("150ms", 150, 100, true, "lower-is-better") as any;
    expect(result.props.children).toHaveLength(2);
  });

  test("returns element in actual displayMode", () => {
    const result = createBaselineCellWithStatus("150ms", 150, 100, true, "lower-is-better", "actual") as any;
    expect(result.props.children).toHaveLength(2);
  });
});

describe("createBaselineCell", () => {
  test("delegates to createBaselineCellWithStatus with lower-is-better", () => {
    const result = createBaselineCell("100ms", 100, 80, true);
    expect(result).not.toBe("100ms");
  });

  test("returns formatted current when no baseline", () => {
    expect(createBaselineCell("100ms", 100, 80, false)).toBe("100ms");
  });
});
