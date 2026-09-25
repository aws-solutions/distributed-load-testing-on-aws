// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipArchive } from "archiver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../../src/logger.js";

import { unzip } from "../../src/archive/unzip.js";
import { buildRawZip } from "./raw-zip.js";

interface ZipEntry {
  readonly path: string;
  readonly content?: string;
  readonly directory?: boolean;
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
    if (entry.directory === true) {
      zip.append("", { name: entry.path.endsWith("/") ? entry.path : `${entry.path}/` });
    } else {
      zip.append(entry.content ?? "", { name: entry.path });
    }
  }
  await zip.finalize();
  await done;
}

describe("unzip", () => {
  let workDir: string;
  let zipPath: string;
  let destDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "dlt-unzip-test-"));
    zipPath = join(workDir, "input.zip");
    destDir = join(workDir, "dest");
    await mkdir(destDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("flattens a single-root-dir zip into destDir", async () => {
    await buildZip(zipPath, [
      { path: "my-test/locustfile.py", content: "from locust import HttpUser" },
      { path: "my-test/locust.conf", content: "users = 10" },
    ]);

    await unzip({ zipPath, destDir });

    const entries = await readdir(destDir);
    expect(entries.sort()).toEqual(["locust.conf", "locustfile.py"]);
    expect(await readFile(join(destDir, "locustfile.py"), "utf8")).toBe("from locust import HttpUser");
  });

  it("preserves nested directories when flattening", async () => {
    await buildZip(zipPath, [
      { path: "project/src/test.py", content: "print('hi')" },
      { path: "project/locust.conf", content: "users = 5" },
    ]);

    await unzip({ zipPath, destDir });

    expect(await readdir(destDir).then((xs) => xs.sort())).toEqual(["locust.conf", "src"]);
    expect(await readdir(join(destDir, "src"))).toEqual(["test.py"]);
  });

  it("does not flatten when zip has multiple root entries", async () => {
    await buildZip(zipPath, [
      { path: "dir-a/file.py", content: "a" },
      { path: "dir-b/file.py", content: "b" },
    ]);

    await unzip({ zipPath, destDir });

    expect(await readdir(destDir).then((xs) => xs.sort())).toEqual(["dir-a", "dir-b"]);
  });

  it("does not flatten when zip has a file and a dir at root", async () => {
    await buildZip(zipPath, [
      { path: "locustfile.py", content: "x" },
      { path: "plugins/helper.py", content: "y" },
    ]);

    await unzip({ zipPath, destDir });

    expect(await readdir(destDir).then((xs) => xs.sort())).toEqual(["locustfile.py", "plugins"]);
  });

  it("still flattens when zip has a single root dir plus macOS metadata", async () => {
    await buildZip(zipPath, [
      { path: "__MACOSX/", directory: true },
      { path: "__MACOSX/._locustfile.py", content: "apple junk" },
      { path: ".DS_Store", content: "apple junk" },
      { path: "my-test/locustfile.py", content: "real content" },
    ]);

    await unzip({ zipPath, destDir });

    expect(await readdir(destDir)).toEqual(["locustfile.py"]);
    expect(await readFile(join(destDir, "locustfile.py"), "utf8")).toBe("real content");
  });

  it("extracts Python package files from inside a wrapper dir", async () => {
    await buildZip(zipPath, [
      { path: "my-test/locustfile.py", content: "from locust import HttpUser" },
      { path: "my-test/__init__.py", content: "" },
      { path: "my-test/pkg/__init__.py", content: "" },
      { path: "my-test/pkg/tasks.py", content: "def noop(): pass" },
    ]);

    await unzip({ zipPath, destDir });

    expect(await readdir(destDir).then((xs) => xs.sort())).toEqual(["__init__.py", "locustfile.py", "pkg"]);
    expect(await readdir(join(destDir, "pkg")).then((xs) => xs.sort())).toEqual(["__init__.py", "tasks.py"]);
  });

  it("extracts underscore-prefixed files at the zip root", async () => {
    await buildZip(zipPath, [
      { path: "locustfile.py", content: "from locust import HttpUser" },
      { path: "__init__.py", content: "" },
    ]);

    await unzip({ zipPath, destDir });

    expect(await readdir(destDir).then((xs) => xs.sort())).toEqual(["__init__.py", "locustfile.py"]);
  });

  it("throws when the zip contains no usable entries", async () => {
    await buildZip(zipPath, [
      { path: "__MACOSX/", directory: true },
      { path: ".DS_Store", content: "junk" },
    ]);

    await expect(unzip({ zipPath, destDir })).rejects.toThrow(
      /contained no usable entries: nothing it extracted survived the ignored-name filter/
    );
  });

  // A bundle built by a script or a CI job, which is the ordinary way to produce
  // one, records permission bits and no unix file type on every entry. Extraction
  // once dropped all of them and failed the run on an unrelated ECS message.
  it("extracts a bundle whose entries record permissions but no file type", async () => {
    await writeFile(
      zipPath,
      buildRawZip([
        { name: "my-test/locustfile.py", content: "from locust import HttpUser", mode: 0o600 },
        { name: "my-test/users.csv", content: "id,name", mode: 0o644 },
        { name: "my-test/locust.conf", content: "users = 10", mode: 0o600 },
      ])
    );

    await unzip({ zipPath, destDir });

    expect(await readdir(destDir).then((xs) => xs.sort())).toEqual(["locust.conf", "locustfile.py", "users.csv"]);
    expect(await readFile(join(destDir, "locustfile.py"), "utf8")).toBe("from locust import HttpUser");
  });

  it("names the skipped entries when every entry is a non-regular file", async () => {
    await writeFile(
      zipPath,
      buildRawZip([
        { name: "locustfile.py", content: "elsewhere.py", mode: 0o120777 },
        { name: "users.csv", content: "elsewhere.csv", mode: 0o120777 },
      ])
    );

    await expect(unzip({ zipPath, destDir })).rejects.toThrow(
      /no entry in it is a regular file.*Skipped: "locustfile\.py" \(mode 0o120777\), "users\.csv" \(mode 0o120777\)\./s
    );
  });

  it("counts the skipped entries it did not name", async () => {
    await writeFile(
      zipPath,
      buildRawZip(
        // Three more than the twenty the summary names, so the tail is counted.
        Array.from({ length: 23 }, (_unused, index) => ({
          name: `link-${index}`,
          content: "elsewhere.py",
          mode: 0o120777,
        }))
      )
    );

    await expect(unzip({ zipPath, destDir })).rejects.toThrow(/"link-19" \(mode 0o120777\), and 3 more\.$/);
  });

  it("reports both an ignored-name extraction and the entries it skipped", async () => {
    await writeFile(
      zipPath,
      buildRawZip([
        { name: ".hidden/locustfile.py", content: "users", mode: 0o600 },
        { name: "link", content: "elsewhere.py", mode: 0o120777 },
      ])
    );

    await expect(unzip({ zipPath, destDir })).rejects.toThrow(
      /nothing it extracted survived the ignored-name filter.*Skipped: "link" \(mode 0o120777\)\./s
    );
  });

  it("reports an archive that holds no files at all", async () => {
    await writeFile(zipPath, buildRawZip([]));

    await expect(unzip({ zipPath, destDir })).rejects.toThrow(/the archive holds no files at all/);
  });

  // A partial skip throws nothing, so warn is the only record an operator sees:
  // createLogger defaults to "info" and no entrypoint overrides it, which would
  // leave a debug line invisible in production.
  it("warns, not debugs, when a bundle extracts but entries were dropped", async () => {
    await writeFile(
      zipPath,
      buildRawZip([
        { name: "locustfile.py", content: "users", mode: 0o600 },
        { name: "users.csv", content: "elsewhere.csv", mode: 0o120777 },
      ])
    );
    const debug = vi.fn();
    const warn = vi.fn();

    await unzip({ zipPath, destDir, logger: { debug, warn } as unknown as Logger });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        zipPath,
        filesWritten: 1,
        skippedCount: 1,
        skippedEntries: [{ name: "users.csv", mode: "0o120777" }],
      }),
      "zip entries skipped as non-regular files"
    );
    expect(debug).not.toHaveBeenCalled();
  });

  it("records a clean extraction at debug only", async () => {
    await writeFile(zipPath, buildRawZip([{ name: "locustfile.py", content: "users", mode: 0o600 }]));
    const debug = vi.fn();
    const warn = vi.fn();

    await unzip({ zipPath, destDir, logger: { debug, warn } as unknown as Logger });

    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ zipPath, filesWritten: 1, skippedCount: 0, skippedEntries: [] }),
      "zip extracted"
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("cleans up the tmp work directory on success", async () => {
    await buildZip(zipPath, [{ path: "foo.txt", content: "bar" }]);

    const before = await listDltUnzipTmpDirs();
    await unzip({ zipPath, destDir });
    const after = await listDltUnzipTmpDirs();

    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("cleans up the tmp work directory on failure", async () => {
    const bogusZipPath = join(workDir, "does-not-exist.zip");

    const before = await listDltUnzipTmpDirs();
    await expect(unzip({ zipPath: bogusZipPath, destDir })).rejects.toThrow();
    const after = await listDltUnzipTmpDirs();

    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});

async function listDltUnzipTmpDirs(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((n) => n.startsWith("dlt-unzip-"));
}
