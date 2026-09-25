// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { TarArchive } from "archiver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installK6 } from "../../src/k6/install-k6.js";

const VERSION = "1.5.0";
const BINARY_TEMPLATE = "https://github.com/grafana/k6/releases/download/v{version}/k6-v{version}-linux-{arch}.tar.gz";
const CHECKSUMS_TEMPLATE = "https://github.com/grafana/k6/releases/download/v{version}/k6-v{version}-checksums.txt";

type InstallerOptions = NonNullable<Parameters<typeof installK6>[0]>;

describe("installK6", () => {
  let testDir: string;
  let manifestPath: string;
  let installParent: string;
  let archive: Buffer;
  let checksums: string;
  let requestedUrls: URL[];
  let retryDelayCaps: number[];
  let fetchImpl: InstallerOptions["fetchImpl"];

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dlt-install-k6-test-"));
    manifestPath = join(testDir, "k6.json");
    installParent = join(testDir, "install");
    requestedUrls = [];
    retryDelayCaps = [];
    await mkdir(installParent);
    await writeManifest();
    useArchive(await buildArchive("amd64"), "amd64");

    fetchImpl = (input) => {
      const url = new URL(input);
      requestedUrls.push(url);
      if (url.pathname.endsWith(".tar.gz")) {
        return Promise.resolve(new Response(new Uint8Array(archive)));
      }
      if (url.pathname.endsWith("-checksums.txt")) {
        return Promise.resolve(new Response(checksums));
      }
      return Promise.resolve(new Response(null, { status: 404, statusText: "Not Found" }));
    };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it.each([
    ["x64", "amd64"],
    ["arm64", "arm64"],
  ] as const)("installs the %s release from the %s archive", async (nodeArchitecture, releaseArchitecture) => {
    useArchive(await buildArchive(releaseArchitecture), releaseArchitecture);

    const binaryPath = await runInstaller(nodeArchitecture);
    const installRoot = dirname(dirname(binaryPath));

    expect(dirname(installRoot)).toBe(installParent);
    expect(basename(installRoot)).toMatch(/^dlt-k6-/);
    expect((await lstat(installRoot)).mode & 0o777).toBe(0o700);
    expect(binaryPath).toBe(join(installRoot, VERSION, "k6"));
    await expect(readFile(binaryPath, "utf8")).resolves.toContain(`k6 v${VERSION}`);
    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      expect.stringContaining(archiveName(releaseArchitecture)),
      expect.stringContaining(`k6-v${VERSION}-checksums.txt`),
    ]);
    expect(retryDelayCaps).toEqual([]);
    await expect(readdir(installRoot)).resolves.toEqual([VERSION]);
  });

  it.each([
    ["binary", BINARY_TEMPLATE.replace("https:", "http:"), CHECKSUMS_TEMPLATE],
    ["checksums", BINARY_TEMPLATE, CHECKSUMS_TEMPLATE.replace("https:", "http:")],
  ])("rejects a non-HTTPS %s URL", async (_field, binary, checksumsUrl) => {
    await writeManifest({
      version: VERSION,
      download: {
        binary,
        checksums: checksumsUrl,
      },
    });

    await expect(runInstaller()).rejects.toThrow("must use HTTPS");
    expect(requestedUrls).toHaveLength(0);
  });

  it("rejects an unsupported architecture before downloading", async () => {
    await expect(runInstaller("s390x")).rejects.toThrow("Unsupported architecture for k6: s390x");
    expect(requestedUrls).toHaveLength(0);
  });

  it.each([
    ["HTTP", () => Promise.resolve(new Response(null, { status: 503, statusText: "Unavailable" }))],
    ["network", () => Promise.reject(new TypeError("fetch failed"))],
    ["timeout", () => Promise.reject(new DOMException("request timed out", "TimeoutError"))],
    [
      "response body",
      () =>
        Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.reject(new Error("response body interrupted")),
        } as unknown as Response),
    ],
  ])("retries a %s failure and succeeds on the next attempt", async (_failureType, fail) => {
    const successfulFetch = fetchImpl;
    let archiveAttempts = 0;
    fetchImpl = (input, init) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".tar.gz") && archiveAttempts++ === 0) {
        requestedUrls.push(url);
        return fail();
      }
      return successfulFetch(input, init);
    };

    await expect(runInstaller()).resolves.toBeTruthy();

    expect(requestedUrls.filter((url) => url.pathname.endsWith(".tar.gz"))).toHaveLength(2);
    expect(retryDelayCaps).toEqual([1_000]);
  });

  it.each([300, 399, 400, 499, 500, 599])("retries HTTP status %i for all three attempts", async (status) => {
    fetchImpl = (input) => {
      requestedUrls.push(new URL(input));
      return Promise.resolve(new Response(null, { status, statusText: "Download Failed" }));
    };

    await expect(runInstaller()).rejects.toThrow(`HTTP ${status} Download Failed`);

    expect(requestedUrls).toHaveLength(3);
    expect(retryDelayCaps).toEqual([1_000, 2_000]);
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it("reports the URL, final cause, and attempt count after retries are exhausted", async () => {
    let attempt = 0;
    fetchImpl = (input) => {
      requestedUrls.push(new URL(input));
      attempt += 1;
      return Promise.reject(new Error(`network failure ${attempt}`));
    };

    let thrown: unknown;
    try {
      await runInstaller();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const downloadError = thrown as Error;
    expect(downloadError.message).toBe(
      `Unable to download https://github.com/grafana/k6/releases/download/v${VERSION}/${archiveName(
        "amd64"
      )} after 3 attempts: network failure 3`
    );
    expect(downloadError.cause).toMatchObject({ message: "network failure 3" });
    expect(requestedUrls).toHaveLength(3);
    expect(retryDelayCaps).toEqual([1_000, 2_000]);
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it("uses independent retry budgets for archive and checksum downloads", async () => {
    const successfulFetch = fetchImpl;
    let archiveFailuresRemaining = 2;
    let checksumFailuresRemaining = 1;
    fetchImpl = (input, init) => {
      const url = new URL(input);
      const shouldFail =
        (url.pathname.endsWith(".tar.gz") && archiveFailuresRemaining-- > 0) ||
        (url.pathname.endsWith("-checksums.txt") && checksumFailuresRemaining-- > 0);
      if (shouldFail) {
        requestedUrls.push(url);
        return Promise.resolve(new Response(null, { status: 503, statusText: "Unavailable" }));
      }
      return successfulFetch(input, init);
    };

    await expect(runInstaller()).resolves.toBeTruthy();

    expect(requestedUrls.filter((url) => url.pathname.endsWith(".tar.gz"))).toHaveLength(3);
    expect(requestedUrls.filter((url) => url.pathname.endsWith("-checksums.txt"))).toHaveLength(2);
    expect(retryDelayCaps).toEqual([1_000, 2_000, 1_000]);
  });

  it("does not retry a filesystem write failure", async () => {
    const successfulFetch = fetchImpl;
    fetchImpl = async (input, init) => {
      const response = await successfulFetch(input, init);
      const [installRoot] = await readdir(installParent);
      if (installRoot === undefined) throw new Error("installer did not create its temporary directory");
      await rm(join(installParent, installRoot, ".download"), { recursive: true, force: true });
      return response;
    };

    await expect(runInstaller()).rejects.toThrow();

    expect(requestedUrls).toHaveLength(1);
    expect(retryDelayCaps).toEqual([]);
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it("requires an exact checksum filename", async () => {
    checksums = checksumLine(archive, `prefix-${archiveName("amd64")}`);

    await expect(runInstaller("x64", "tar-must-not-run")).rejects.toThrow("No checksum found");
    expect(requestedUrls).toHaveLength(2);
    expect(retryDelayCaps).toEqual([]);
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it.each(["  ", " *", "\t"])("accepts a checksum record using the %j separator", async (separator) => {
    checksums = checksumLine(archive, archiveName("amd64"), separator);

    await expect(runInstaller()).resolves.toBeTruthy();
  });

  it("rejects a checksum mismatch before extraction", async () => {
    checksums = `${"0".repeat(64)}  ${archiveName("amd64")}\n`;

    await expect(runInstaller("x64", "tar-must-not-run")).rejects.toThrow("Checksum mismatch");
    expect(requestedUrls).toHaveLength(2);
    expect(retryDelayCaps).toEqual([]);
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it("does not retry extraction failures", async () => {
    await expect(runInstaller("x64", "tar-must-not-run")).rejects.toThrow();

    expect(requestedUrls).toHaveLength(2);
    expect(retryDelayCaps).toEqual([]);
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it("extracts only the expected k6 binary", async () => {
    useArchive(await buildArchive("amd64", { extraEntry: "README.md" }), "amd64");

    const binaryPath = await runInstaller();

    await expect(readFile(binaryPath, "utf8")).resolves.toContain(`k6 v${VERSION}`);
    await expect(access(join(dirname(binaryPath), "README.md"))).rejects.toThrow();
  });

  it("rejects a link in place of the k6 binary", async () => {
    useArchive(await buildArchive("amd64", { binaryLink: "../outside" }), "amd64");

    await expect(runInstaller()).rejects.toThrow("not a regular file");
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it("rejects a non-executable k6 binary", async () => {
    useArchive(await buildArchive("amd64", { mode: 0o644 }), "amd64");

    await expect(runInstaller()).rejects.toThrow();
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  it("rejects a k6 binary that reports another version", async () => {
    useArchive(await buildArchive("amd64", { binary: '#!/bin/sh\necho "k6 v0.0.0"\n' }), "amd64");

    await expect(runInstaller()).rejects.toThrow("unexpected version");
    expect(requestedUrls).toHaveLength(2);
    expect(retryDelayCaps).toEqual([]);
    await expect(readdir(installParent)).resolves.toEqual([]);
  });

  async function writeManifest(
    manifest: unknown = {
      version: VERSION,
      download: { binary: BINARY_TEMPLATE, checksums: CHECKSUMS_TEMPLATE },
    }
  ): Promise<void> {
    await writeFile(manifestPath, JSON.stringify(manifest));
  }

  function useArchive(content: Buffer, architecture: "amd64" | "arm64"): void {
    archive = content;
    checksums = checksumLine(content, archiveName(architecture));
  }

  function runInstaller(architecture: NodeJS.Architecture = "x64", tarCommand = "tar"): Promise<string> {
    return installK6({
      manifestPath,
      temporaryDirectory: installParent,
      architecture,
      fetchImpl,
      tarCommand,
      waitBeforeRetry: (maximumDelayMs) => {
        retryDelayCaps.push(maximumDelayMs);
        return Promise.resolve();
      },
    });
  }
});

interface ArchiveOptions {
  readonly binary?: string;
  readonly binaryLink?: string;
  readonly mode?: number;
  readonly extraEntry?: string;
}

async function buildArchive(architecture: "amd64" | "arm64", options: ArchiveOptions = {}): Promise<Buffer> {
  const directory = `k6-v${VERSION}-linux-${architecture}`;
  const archive = new TarArchive({ gzip: true });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    archive.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    archive.on("error", reject);
  });

  archive.append(Buffer.alloc(0), { name: `${directory}/`, type: "directory", mode: 0o755 });
  if (options.binaryLink === undefined) {
    archive.append(Buffer.from(options.binary ?? versionScript()), {
      name: `${directory}/k6`,
      type: "file",
      mode: options.mode ?? 0o755,
    });
  } else {
    archive.symlink(`${directory}/k6`, options.binaryLink);
  }
  if (options.extraEntry !== undefined) {
    archive.append(Buffer.from("unexpected"), { name: options.extraEntry, type: "file", mode: 0o644 });
  }

  await archive.finalize();
  return output;
}

function versionScript(): string {
  return `#!/bin/sh\necho "k6 v${VERSION} (go1.24.0, linux/amd64)"\n`;
}

function archiveName(architecture: "amd64" | "arm64"): string {
  return `k6-v${VERSION}-linux-${architecture}.tar.gz`;
}

function checksumLine(content: Buffer, filename: string, separator = "  "): string {
  return `${createHash("sha256").update(content).digest("hex")}${separator}${filename}\n`;
}
