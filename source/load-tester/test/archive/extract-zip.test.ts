// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipArchive } from "archiver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractZip } from "../../src/archive/extract-zip.js";
import { buildRawZip, type RawZipEntry } from "./raw-zip.js";

interface ZipEntry {
  readonly path: string;
  readonly content?: string;
  readonly directory?: boolean;
  /** When set, the entry is written as a symlink pointing at this target. */
  readonly symlinkTo?: string;
}

async function buildZip(zipPath: string, entries: readonly ZipEntry[]): Promise<void> {
  const output = createWriteStream(zipPath);
  const zip = new ZipArchive({ zlib: { level: 0 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    zip.on("warning", reject);
    zip.on("error", reject);
  });

  zip.pipe(output);
  for (const entry of entries) {
    if (entry.symlinkTo !== undefined) {
      zip.symlink(entry.path, entry.symlinkTo);
    } else if (entry.directory === true) {
      zip.append("", { name: entry.path.endsWith("/") ? entry.path : `${entry.path}/` });
    } else {
      zip.append(entry.content ?? "", { name: entry.path });
    }
  }
  await zip.finalize();
  await done;
}

// A zip that genuinely contains a parent-traversal entry named "../escape.txt".
// archiver normalizes such names away, so this payload is stored as a base64
// constant. yauzl rejects the traversal path when the archive is read.
const ZIP_SLIP_BASE64 =
  "UEsDBBQAAAAAAEOIGl1+UwTZBQAAAAUAAAANAAAALi4vZXNjYXBlLnR4dHB3bmVkUEsBAhQAFAAAAAAAQ4gaXX5TBNkFAAAABQAAAA0AAAAAAAAAAAAAAAAAAAAAAC4uL2VzY2FwZS50eHRQSwUGAAAAAAEAAQA7AAAAMAAAAAAA";

describe("extractZip", () => {
  let workDir: string;
  let zipPath: string;
  let destDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "dlt-extract-zip-test-"));
    zipPath = join(workDir, "input.zip");
    destDir = join(workDir, "dest");
    await mkdir(destDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("extracts files and nested directories into destDir", async () => {
    await buildZip(zipPath, [
      { path: "top.txt", content: "hello" },
      { path: "sub/inner.txt", content: "world" },
    ]);

    await extractZip(zipPath, destDir);

    expect(await readFile(join(destDir, "top.txt"), "utf8")).toBe("hello");
    expect(await readFile(join(destDir, "sub", "inner.txt"), "utf8")).toBe("world");
  });

  it("skips symlink entries instead of recreating them", async () => {
    await buildZip(zipPath, [
      { path: "real.txt", content: "ok" },
      { path: "link", symlinkTo: "real.txt" },
    ]);

    await extractZip(zipPath, destDir);

    expect(await readFile(join(destDir, "real.txt"), "utf8")).toBe("ok");
    // The symlink is not recreated, so its name never appears in destDir.
    await expect(lstat(join(destDir, "link"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(destDir)).toEqual(["real.txt"]);
  });

  it("does not let a symlink entry redirect writes outside destDir", async () => {
    // The classic GHSA-jmr9-qjv8-65gv attack: a symlink entry points at a
    // directory outside destDir, then a later entry writes "through" it.
    const outside = join(workDir, "outside");
    await mkdir(outside, { recursive: true });
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "original");

    await buildZip(zipPath, [
      { path: "escape", symlinkTo: outside },
      { path: "escape/pwned.txt", content: "attacker" },
    ]);

    await extractZip(zipPath, destDir);

    // The symlink was skipped, so "escape" is a real directory inside destDir and
    // the write stayed contained. The outside directory is untouched.
    expect(await readFile(secret, "utf8")).toBe("original");
    expect(await readdir(outside)).toEqual(["secret.txt"]);
    expect(await readFile(join(destDir, "escape", "pwned.txt"), "utf8")).toBe("attacker");
  });

  it("rejects a zip-slip entry and writes nothing outside destDir", async () => {
    await writeFile(zipPath, Buffer.from(ZIP_SLIP_BASE64, "base64"));

    await expect(extractZip(zipPath, destDir)).rejects.toThrow();
    // destDir is workDir/dest, so "../escape.txt" would land in workDir; it must not.
    await expect(lstat(join(workDir, "escape.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  // Every writer records an entry's unix mode differently, and only the type
  // field says what kind of file it is. A filter that read the whole mode instead
  // dropped every entry from a permission-only writer such as Python's zipfile,
  // emptying the archive and failing the run on an unrelated ECS message.
  describe("unix mode handling", () => {
    async function writeRawZip(entries: readonly RawZipEntry[]): Promise<void> {
      await writeFile(zipPath, buildRawZip(entries));
    }

    const extractedModes: readonly (readonly [string, number])[] = [
      ["a full regular-file mode, as the zip CLI and archiver write", 0o100644],
      ["permission bits with no file type, as Python's zipfile.writestr writes", 0o600],
      ["permission bits with no file type and the group bit set", 0o644],
      ["an executable mode with no file type", 0o755],
      ["no mode at all", 0],
    ];

    for (const [description, mode] of extractedModes) {
      it(`extracts an entry recording ${description}`, async () => {
        await writeRawZip([{ name: "locustfile.py", content: "from locust import HttpUser", mode }]);

        const summary = await extractZip(zipPath, destDir);

        expect(await readFile(join(destDir, "locustfile.py"), "utf8")).toBe("from locust import HttpUser");
        expect(summary.filesWritten).toBe(1);
        expect(summary.skippedCount).toBe(0);
      });
    }

    // A zip from Windows Explorer or Compress-Archive: no unix mode, only DOS
    // attribute bits in the low half of the external file attributes. They must
    // never be read as a file type.
    it("extracts an entry that records DOS attributes and no unix mode", async () => {
      await writeRawZip([
        { name: "locustfile.py", content: "from locust import HttpUser", mode: 0, dosAttributes: 0x20 },
      ]);

      const summary = await extractZip(zipPath, destDir);

      expect(await readFile(join(destDir, "locustfile.py"), "utf8")).toBe("from locust import HttpUser");
      expect(summary.filesWritten).toBe(1);
      expect(summary.skippedCount).toBe(0);
    });

    it("ignores DOS attributes on an entry that also records a symlink mode", async () => {
      await writeRawZip([
        { name: "real.txt", content: "ok", mode: 0o600 },
        { name: "link", content: "real.txt", mode: 0o120777, dosAttributes: 0x20 },
      ]);

      const summary = await extractZip(zipPath, destDir);

      expect(await readdir(destDir)).toEqual(["real.txt"]);
      expect(summary.skippedEntries).toEqual([{ name: "link", mode: "0o120777" }]);
    });

    const skippedModes: readonly (readonly [string, number])[] = [
      ["a symlink", 0o120777],
      ["a character device", 0o020666],
      ["a block device", 0o060660],
      ["a FIFO", 0o010644],
      ["a socket", 0o140755],
    ];

    for (const [description, mode] of skippedModes) {
      it(`skips an entry recording ${description}`, async () => {
        await writeRawZip([
          { name: "real.txt", content: "ok", mode: 0o600 },
          { name: "special", content: "real.txt", mode },
        ]);

        const summary = await extractZip(zipPath, destDir);

        expect(await readdir(destDir)).toEqual(["real.txt"]);
        expect(summary.filesWritten).toBe(1);
        expect(summary.skippedCount).toBe(1);
        expect(summary.skippedEntries).toEqual([{ name: "special", mode: `0o${mode.toString(8)}` }]);
      });
    }

    it("summarizes files, directories, and skipped entries", async () => {
      await writeRawZip([
        { name: "bundle/", mode: 0o040755 },
        { name: "bundle/locustfile.py", content: "users", mode: 0o600 },
        { name: "bundle/data.csv", content: "a,b", mode: 0o644 },
        { name: "bundle/link", content: "data.csv", mode: 0o120777 },
      ]);

      const summary = await extractZip(zipPath, destDir);

      expect(summary).toEqual({
        filesWritten: 2,
        directoriesCreated: 1,
        skippedCount: 1,
        skippedEntries: [{ name: "bundle/link", mode: "0o120777" }],
      });
    });

    it("counts every skipped entry but names only the first twenty", async () => {
      await writeRawZip(
        Array.from({ length: 25 }, (_unused, index) => ({
          name: `link-${index}`,
          content: "target",
          mode: 0o120777,
        }))
      );

      const summary = await extractZip(zipPath, destDir);

      expect(summary.skippedCount).toBe(25);
      expect(summary.skippedEntries).toHaveLength(20);
      expect(summary.skippedEntries[0]).toEqual({ name: "link-0", mode: "0o120777" });
      expect(await readdir(destDir)).toEqual([]);
    });
  });

  // An entry name is attacker-controlled text that ends up in a log, so the
  // summary shapes it. A zip that sets the UTF-8 name flag, as modern writers do,
  // gets its name decoded verbatim rather than through yauzl's CP437 table, so
  // control bytes reach the summary unless they are removed here.
  describe("skipped entry names are safe to log", () => {
    const NEWLINE = String.fromCharCode(10);
    const ESC = String.fromCharCode(27);

    async function skipEntryNamed(name: string): Promise<string> {
      await writeFile(zipPath, buildRawZip([{ name, content: "target", mode: 0o120777, utf8NameFlag: true }]));
      const summary = await extractZip(zipPath, destDir);
      expect(summary.skippedEntries).toHaveLength(1);
      return summary.skippedEntries[0]?.name ?? "";
    }

    it("replaces a raw newline that would otherwise forge a log line", async () => {
      const reported = await skipEntryNamed(`a${NEWLINE}INFO fake log line`);

      expect(reported).not.toContain(NEWLINE);
      expect(reported).toBe("a�INFO fake log line");
    });

    it("removes an ANSI escape sequence", async () => {
      const reported = await skipEntryNamed(`${ESC}[31mred${ESC}[0m.py`);

      expect(reported).not.toContain(ESC);
      expect(reported).toBe("red.py");
    });

    it("replaces a bidirectional override that would disguise the name", async () => {
      // U+202E right-to-left override, the Trojan Source trick.
      const reported = await skipEntryNamed("safe‮gpj.exe");

      expect(reported).toBe("safe�gpj.exe");
    });

    it("bounds a name long enough to blow the log event size limit", async () => {
      const reported = await skipEntryNamed("A".repeat(4000));

      expect(reported).toHaveLength(200 + "...(truncated)".length);
      expect(reported.endsWith("...(truncated)")).toBe(true);
    });

    it("leaves an ordinary name untouched", async () => {
      const reported = await skipEntryNamed("my-test/orders-192.168.0.1-123456789012.csv");

      expect(reported).toBe("my-test/orders-192.168.0.1-123456789012.csv");
    });
  });
});
