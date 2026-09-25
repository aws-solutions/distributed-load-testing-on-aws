// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { readSpecFile, applySpecFile } from "../../src/lib/spec-file.js";

function tmpFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dlt-spec-"));
  const path = join(dir, "spec.json");
  writeFileSync(path, contents, "utf-8");
  return path;
}

/** A command whose options mirror the fields a spec file may carry. */
function specCommand(argv: string[]): Command {
  const cmd = new Command();
  cmd
    .option("--test-name <n>")
    .option("--concurrency <n>")
    .option("--regions <r>")
    .option("--tags <t>")
    .option("--native-mode")
    .option("--headers <h>")
    .option("--from-file <p>")
    .option("--format <f>")
    .allowExcessArguments(true);
  cmd.parse(["node", "x", ...argv]);
  return cmd;
}

describe("readSpecFile", () => {
  it("parses a JSON object", () => {
    const path = tmpFile('{"testName":"A"}');
    expect(readSpecFile(path)).toEqual({ testName: "A" });
  });

  it("throws on unreadable path", () => {
    expect(() => readSpecFile("/no/such/spec.json")).toThrow(/Cannot read spec file/);
  });

  it("throws on invalid JSON", () => {
    const path = tmpFile("{ not json ");
    expect(() => readSpecFile(path)).toThrow(/not valid JSON/);
  });

  it("throws when the top-level value is not an object", () => {
    const path = tmpFile("[1,2,3]");
    expect(() => readSpecFile(path)).toThrow(/must contain a JSON object/);
  });
});

describe("applySpecFile", () => {
  it("fills option values from the spec", () => {
    const cmd = specCommand([]);
    const options = cmd.opts();
    applySpecFile(options, { testName: "FromFile", concurrency: 10 }, cmd);
    expect(options["testName"]).toBe("FromFile");
    // Numbers are coerced to the string form a flag would produce.
    expect(options["concurrency"]).toBe("10");
  });

  it("lets an explicit flag win over the spec", () => {
    const cmd = specCommand(["--test-name", "FromFlag"]);
    const options = cmd.opts();
    applySpecFile(options, { testName: "FromFile" }, cmd);
    expect(options["testName"]).toBe("FromFlag");
  });

  it("joins array values (regions, tags) into comma strings", () => {
    const cmd = specCommand([]);
    const options = cmd.opts();
    applySpecFile(options, { regions: ["us-east-1", "eu-west-1"], tags: ["a", "b"] }, cmd);
    expect(options["regions"]).toBe("us-east-1,eu-west-1");
    expect(options["tags"]).toBe("a,b");
  });

  it("stringifies object values (headers)", () => {
    const cmd = specCommand([]);
    const options = cmd.opts();
    applySpecFile(options, { headers: { Authorization: "Bearer x" } }, cmd);
    expect(options["headers"]).toBe('{"Authorization":"Bearer x"}');
  });

  it("coerces boolean options from real booleans", () => {
    const cmd = specCommand([]);
    const options = cmd.opts();
    applySpecFile(options, { nativeMode: true }, cmd);
    expect(options["nativeMode"]).toBe(true);
  });

  it("accepts explicit true/false string and 1/0 forms for booleans", () => {
    for (const [input, expected] of [
      ["true", true],
      ["false", false],
      ["FALSE", false],
      [1, true],
      [0, false],
    ] as const) {
      const cmd = specCommand([]);
      const options = cmd.opts();
      applySpecFile(options, { nativeMode: input }, cmd);
      expect(options["nativeMode"]).toBe(expected);
    }
  });

  it("does not treat the string \"false\" as true", () => {
    const cmd = specCommand([]);
    const options = cmd.opts();
    applySpecFile(options, { nativeMode: "false" }, cmd);
    expect(options["nativeMode"]).toBe(false);
  });

  it("rejects an ambiguous boolean value", () => {
    const cmd = specCommand([]);
    expect(() => applySpecFile(cmd.opts(), { nativeMode: "yes" }, cmd)).toThrow(
      /Spec field "nativeMode" must be a boolean/
    );
  });

  it("rejects an unknown field", () => {
    const cmd = specCommand([]);
    expect(() => applySpecFile(cmd.opts(), { bogusKey: "x" }, cmd)).toThrow(/Unknown field\(s\) in spec file: bogusKey/);
  });
});
