// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatJson, formatTable, cellValue, printResult, formatOption } from "../../src/lib/output.js";

describe("output", () => {
  describe("formatJson", () => {
    it("formats object as pretty JSON", () => {
      const result = formatJson({ a: 1, b: "hello" });
      expect(result).toBe('{\n  "a": 1,\n  "b": "hello"\n}');
    });

    it("formats array", () => {
      const result = formatJson([1, 2, 3]);
      expect(result).toBe("[\n  1,\n  2,\n  3\n]");
    });
  });

  describe("cellValue", () => {
    it("returns empty string for null", () => {
      expect(cellValue(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(cellValue(undefined)).toBe("");
    });

    it("returns string as-is", () => {
      expect(cellValue("hello")).toBe("hello");
    });

    it("returns integer without decimals", () => {
      expect(cellValue(42)).toBe("42");
    });

    it("rounds small floats to 2 decimal places", () => {
      expect(cellValue(39.12222222222222)).toBe("39.12");
      expect(cellValue(0.12999999999999998)).toBe("0.13");
    });

    it("formats large numbers with locale grouping and no decimals", () => {
      const result = cellValue(120772216.98888889);
      // Should have no decimals and use comma grouping
      expect(result).toBe("120,772,217");
    });

    it("serializes objects as compact JSON", () => {
      expect(cellValue({ p50: 21, p90: 30 })).toBe('{"p50":21,"p90":30}');
    });

    it("serializes arrays as compact JSON", () => {
      expect(cellValue([1, 2, 3])).toBe("[1,2,3]");
    });

    it("handles Infinity", () => {
      expect(cellValue(Infinity)).toBe("Infinity");
    });

    it("handles NaN", () => {
      expect(cellValue(NaN)).toBe("NaN");
    });

    it("handles boolean", () => {
      expect(cellValue(true)).toBe("true");
    });
  });

  describe("formatTable", () => {
    it("formats array of objects as table", () => {
      const data = [
        { id: "abc", name: "Test 1" },
        { id: "def", name: "Test 2" },
      ];
      const result = formatTable(data);
      expect(result).toContain("id");
      expect(result).toContain("name");
      expect(result).toContain("abc");
      expect(result).toContain("Test 1");
      expect(result).toContain("def");
      expect(result).toContain("Test 2");
    });

    it("returns no results for empty array", () => {
      expect(formatTable([])).toBe("(no results)");
    });

    it("renders nested objects as JSON instead of [object Object]", () => {
      const data = [{ id: "x", nested: { a: 1, b: 2 } }];
      const result = formatTable(data);
      expect(result).not.toContain("[object Object]");
      expect(result).toContain('{"a":1,"b":2}');
    });

    it("formats numbers with limited decimals", () => {
      const data = [{ metric: 39.12222222222222 }];
      const result = formatTable(data);
      expect(result).toContain("39.12");
      expect(result).not.toContain("39.12222");
    });

    it("formats large numbers with commas", () => {
      const data = [{ bandwidth: 120772216.98888889 }];
      const result = formatTable(data);
      expect(result).toContain("120,772,217");
    });

    it("handles column width up to 120 characters", () => {
      const longStr = "x".repeat(130);
      const data = [{ msg: longStr }];
      const result = formatTable(data);
      // Should be truncated at 120, not 60
      const lines = result.split("\n");
      const dataLine = lines[2]!;
      // The truncated value should be 120 x's
      expect(dataLine.trim()).toBe("x".repeat(120));
    });
  });
});

describe("printResult", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("prints table format for array of objects", () => {
    printResult([{ id: "t1", name: "Test" }], { format: "table" });
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    expect(output).toContain("t1");
    expect(output).toContain("Test");
  });

  it("prints table format for single object", () => {
    printResult({ id: "t1", name: "Test" }, { format: "table" });
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    expect(output).toContain("t1");
  });

  it("prints no results message to stderr for empty array in table format", () => {
    printResult([], { format: "table" });
    expect(stderrSpy).toHaveBeenCalledWith("(no results)");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("prints JSON format to stdout", () => {
    printResult({ id: "t1" }, { format: "json" });
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    expect(JSON.parse(output)).toEqual({ id: "t1" });
  });

  it("prints empty JSON array for empty data", () => {
    printResult([], { format: "json" });
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    expect(JSON.parse(output)).toEqual([]);
  });

  it("defaults to table format when no format specified", () => {
    printResult([{ id: "t1" }]);
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    expect(output).toContain("t1");
  });

  it("handles non-object non-array data in table format", () => {
    printResult(null, { format: "table" });
    expect(stderrSpy).toHaveBeenCalledWith("(no results)");
  });
});

describe("formatOption", () => {
  it("returns a Commander Option", () => {
    const opt = formatOption();
    expect(opt).toBeDefined();
    expect(opt.long).toBe("--format");
  });

  it("has choices json and table", () => {
    const opt = formatOption();
    expect(opt.argChoices).toContain("json");
    expect(opt.argChoices).toContain("table");
  });

  it("defaults to table", () => {
    const opt = formatOption();
    expect(opt.defaultValue).toBe("table");
  });
});
