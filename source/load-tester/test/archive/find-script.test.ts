// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findScript } from "../../src/archive/find-script.js";

describe("findScript", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dlt-find-script-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function touch(name: string, content = ""): Promise<void> {
    await writeFile(join(dir, name), content);
  }

  describe("jmeter", () => {
    it("returns the .jmx file at the top level", async () => {
      await touch("my-test.jmx", "<TestPlan/>");
      expect(await findScript({ dir, framework: "jmeter" })).toBe(join(dir, "my-test.jmx"));
    });

    it("returns the alphabetically-first .jmx when multiple exist", async () => {
      await touch("b-test.jmx");
      await touch("a-test.jmx");
      await touch("c-test.jmx");
      expect(await findScript({ dir, framework: "jmeter" })).toBe(join(dir, "a-test.jmx"));
    });

    it("throws when no .jmx is present", async () => {
      await touch("readme.txt");
      await expect(findScript({ dir, framework: "jmeter" })).rejects.toThrow(/No \.jmx file found/);
    });

    it("matches .jmx case-insensitively on the extension", async () => {
      await touch("test.JMX");
      expect(await findScript({ dir, framework: "jmeter" })).toBe(join(dir, "test.JMX"));
    });
  });

  describe("k6", () => {
    it("returns the .ts file when only .ts exists", async () => {
      await touch("script.ts");
      expect(await findScript({ dir, framework: "k6" })).toBe(join(dir, "script.ts"));
    });

    it("returns the .js file when only .js exists", async () => {
      await touch("script.js");
      expect(await findScript({ dir, framework: "k6" })).toBe(join(dir, "script.js"));
    });

    it("prefers .ts over .js when both exist", async () => {
      await touch("script.ts");
      await touch("script.js");
      expect(await findScript({ dir, framework: "k6" })).toBe(join(dir, "script.ts"));
    });

    it("throws when no .ts or .js is present", async () => {
      await touch("script.py");
      await expect(findScript({ dir, framework: "k6" })).rejects.toThrow(/No \.ts or \.js file found/);
    });
  });

  describe("locust", () => {
    it("returns locustfile.py at the top level", async () => {
      await touch("locustfile.py");
      expect(await findScript({ dir, framework: "locust" })).toBe(join(dir, "locustfile.py"));
    });

    it("throws when locustfile.py is absent, even if other .py files exist", async () => {
      await touch("tests.py");
      await touch("helper.py");
      await expect(findScript({ dir, framework: "locust" })).rejects.toThrow(/No "locustfile\.py" file found/);
    });

    it("is case-sensitive for the exact name", async () => {
      await touch("LocustFile.py");
      await expect(findScript({ dir, framework: "locust" })).rejects.toThrow(/No "locustfile\.py" file found/);
    });

    it("finds locustfile.py alongside a sibling __init__.py", async () => {
      await touch("__init__.py");
      await touch("locustfile.py");
      expect(await findScript({ dir, framework: "locust" })).toBe(join(dir, "locustfile.py"));
    });
  });

  describe("common behavior", () => {
    it("ignores .DS_Store and __MACOSX entries", async () => {
      await touch(".DS_Store");
      await mkdir(join(dir, "__MACOSX"));
      await touch("script.ts");
      expect(await findScript({ dir, framework: "k6" })).toBe(join(dir, "script.ts"));
    });

    it("does not recurse into subdirectories", async () => {
      await mkdir(join(dir, "nested"));
      await writeFile(join(dir, "nested", "inner.jmx"), "<TestPlan/>");
      await expect(findScript({ dir, framework: "jmeter" })).rejects.toThrow(/No \.jmx file found/);
    });
  });
});
