// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatCsv, printResult } from "../../src/lib/output.js";

describe("formatCsv", () => {
  it("returns empty string for empty array", () => {
    expect(formatCsv([])).toBe("");
  });

  it("formats a single record with header row", () => {
    const data = [{ name: "Test1", value: 42 }];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines[0]).toBe("name,value");
    expect(lines[1]).toBe("Test1,42");
  });

  it("formats multiple records", () => {
    const data = [
      { id: "a", score: 10 },
      { id: "b", score: 20 },
    ];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("id,score");
    expect(lines[1]).toBe("a,10");
    expect(lines[2]).toBe("b,20");
  });

  it("quotes values containing commas", () => {
    const data = [{ desc: "hello, world", count: 1 }];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines[1]).toBe('"hello, world",1');
  });

  it("quotes values containing double quotes and escapes them by doubling", () => {
    const data = [{ text: 'He said "hi"', num: 5 }];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines[1]).toBe('"He said ""hi""",5');
  });

  it("quotes values containing newlines", () => {
    const data = [{ text: "line1\nline2", num: 3 }];
    const result = formatCsv(data);
    // The value should be wrapped in quotes
    expect(result).toContain('"line1\nline2"');
  });

  it("quotes values containing carriage returns", () => {
    const data = [{ text: "line1\r\nline2", num: 7 }];
    const result = formatCsv(data);
    expect(result).toContain('"line1\r\nline2"');
  });

  it("handles null and undefined values as empty strings", () => {
    const data = [{ a: null, b: undefined, c: "ok" }];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines[1]).toBe(",,ok");
  });

  it("serializes object values as JSON", () => {
    const data = [{ meta: { p50: 21, p90: 30 } }];
    const result = formatCsv(data);
    const lines = result.split("\n");
    // JSON contains commas so it should be quoted
    expect(lines[1]).toBe('"{""p50"":21,""p90"":30}"');
  });

  it("handles header fields that contain special characters", () => {
    const data = [{ "field,one": "a", 'field"two': "b" }];
    const result = formatCsv(data);
    const lines = result.split("\n");
    expect(lines[0]).toBe('"field,one","field""two"');
  });

  it("round-trip: CSV output can be parsed back to equivalent records", () => {
    const data = [
      { avgResponseTime: 120.5, p50: 100, p95: 200, p99: 350, errorRate: 2.5, totalRequests: 5000, throughput: 83.3 },
      { avgResponseTime: 95.2, p50: 80, p95: 150, p99: 280, errorRate: 1.1, totalRequests: 8000, throughput: 133.3 },
    ];

    const csv = formatCsv(data);
    const lines = csv.split("\n");
    const headers = lines[0]!.split(",");

    // Parse each data line back
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i]!.split(",");
      const original = data[i - 1]!;
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j]!;
        const parsedVal = values[j]!;
        const originalVal = String(original[key]);
        expect(parsedVal).toBe(originalVal);
      }
    }
  });

  it("round-trip with string and numeric values", () => {
    const data = [
      { name: "Test A", score: 99, rate: 0.75 },
      { name: "Test B", score: 42, rate: 1.5 },
    ];

    const csv = formatCsv(data);
    const lines = csv.split("\n");
    const headers = lines[0]!.split(",");

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]!);
      const original = data[i - 1]!;
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j]!;
        const originalVal = original[key];
        const parsedVal = values[j]!;
        if (typeof originalVal === "number") {
          expect(Number(parsedVal)).toBe(originalVal);
        } else {
          expect(parsedVal).toBe(String(originalVal));
        }
      }
    }
  });

  it("round-trip with values requiring quoting", () => {
    const data = [{ description: 'Value with "quotes" and, commas', count: 10 }];

    const csv = formatCsv(data);
    const lines = csv.split("\n");
    const headers = parseCsvLine(lines[0]!);
    const values = parseCsvLine(lines[1]!);

    expect(headers).toEqual(["description", "count"]);
    expect(values[0]).toBe('Value with "quotes" and, commas');
    expect(values[1]).toBe("10");
  });
});

describe("formatCsv formula injection prevention", () => {
  it("neutralizes a value beginning with =", () => {
    const data = [{ name: "=1+2", count: 1 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("'=1+2,1");
  });

  it("neutralizes a value beginning with +", () => {
    const data = [{ name: "+1", count: 1 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("'+1,1");
  });

  it("neutralizes a value beginning with -", () => {
    const data = [{ name: "-1+2", count: 1 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("'-1+2,1");
  });

  it("neutralizes a value beginning with @", () => {
    const data = [{ name: "@SUM(A1:A9)", count: 1 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("'@SUM(A1:A9),1");
  });

  it("neutralizes a value beginning with a tab", () => {
    const data = [{ name: "\t=1+2", count: 1 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("'\t=1+2,1");
  });

  it("neutralizes a value beginning with a carriage return", () => {
    const data = [{ name: "\r=1+2", count: 1 }];
    const lines = formatCsv(data).split("\n");
    // wrapped for RFC 4180 because it contains CR, and prefixed so it stays inert
    expect(lines[1]).toBe('"\'\r=1+2",1');
  });

  it("neutralizes a value beginning with a line feed", () => {
    const data = [{ name: "\n=1+2", count: 1 }];
    const result = formatCsv(data);
    expect(result).toContain('"\'\n=1+2"');
  });

  it("neutralizes a formula that also requires RFC 4180 quoting", () => {
    // Contains a comma, so the quote-prefixed value must also be wrapped in quotes.
    const data = [{ name: "=HYPERLINK(1,2)", count: 1 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe('"\'=HYPERLINK(1,2)",1');
  });

  it("neutralizes a classic exfiltration payload as a scenario name", () => {
    const data = [{ scenarioName: "=cmd|'/c calc'!A1" }];
    const lines = formatCsv(data).split("\n");
    // Leading quote makes the cell inert. The payload contains no RFC 4180
    // special characters (comma, double quote, CR, LF), so no field wrapping.
    expect(lines[1]).toBe("'=cmd|'/c calc'!A1");
  });

  it("neutralizes a formula-triggering header field", () => {
    const data = [{ "=name": "value" }];
    const lines = formatCsv(data).split("\n");
    expect(lines[0]).toBe("'=name");
  });

  it("leaves normal string values unchanged", () => {
    const data = [{ name: "Load Test 1", count: 3 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("Load Test 1,3");
  });

  it("leaves values containing but not starting with a trigger unchanged", () => {
    const data = [{ name: "a=b", email: "user@example.com" }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("a=b,user@example.com");
  });

  it("does not alter numeric or boolean cells rendered without a trigger prefix", () => {
    const data = [{ score: 42, ok: true }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("42,true");
  });

  it("does not prefix negative numbers even though they start with a trigger char", () => {
    // Numbers can never be interpreted as formulas; prefixing -5 to '-5 would
    // corrupt the value by importing it as text.
    const data = [{ delta: -5, rate: -0.25 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("-5,-0.25");
  });

  it("still neutralizes the string '-5 formula but not the number -5", () => {
    const data = [{ fromString: "-5+3", fromNumber: -5 }];
    const lines = formatCsv(data).split("\n");
    expect(lines[1]).toBe("'-5+3,-5");
  });
});

describe("printResult with csv format", () => {
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

  it("prints CSV format for array of objects", () => {
    printResult([{ id: "t1", name: "Test" }], { format: "csv" });
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    expect(output).toContain("id,name");
    expect(output).toContain("t1,Test");
  });

  it("prints CSV format for single object", () => {
    printResult({ id: "t1", name: "Test" }, { format: "csv" });
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    expect(output).toContain("id,name");
    expect(output).toContain("t1,Test");
  });

  it("prints no results message to stderr for empty array in csv format", () => {
    printResult([], { format: "csv" });
    expect(stderrSpy).toHaveBeenCalledWith("(no results)");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("prints no results for null data in csv format", () => {
    printResult(null, { format: "csv" });
    expect(stderrSpy).toHaveBeenCalledWith("(no results)");
  });
});

// ---------------------------------------------------------------------------
// Simple RFC 4180 CSV line parser for round-trip testing
// ---------------------------------------------------------------------------
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      let value = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
      // Skip comma separator
      if (i < line.length && line[i] === ",") {
        i++;
      }
    } else {
      // Unquoted field
      const nextComma = line.indexOf(",", i);
      if (nextComma === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, nextComma));
        i = nextComma + 1;
      }
    }
  }

  return fields;
}
