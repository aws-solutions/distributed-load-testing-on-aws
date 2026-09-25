// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const RETRY_DELAY_BASE_MS = 1_000;
const TAR_TIMEOUT_MS = 30_000;
const VERSION_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

interface K6Manifest {
  readonly version: string;
  readonly download: {
    readonly binary: string;
    readonly checksums: string;
  };
}

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;
type RetryWaitImplementation = (maximumDelayMs: number) => Promise<void>;

interface K6InstallerOptions {
  readonly manifestPath: string;
  readonly temporaryDirectory: string;
  readonly architecture: NodeJS.Architecture;
  readonly fetchImpl: FetchImplementation;
  readonly tarCommand: string;
  readonly waitBeforeRetry?: RetryWaitImplementation;
}

/** Uses the paths and tools available inside the production container. */
function productionOptions(): K6InstallerOptions {
  return {
    manifestPath: "/opt/dlt/k6.json",
    temporaryDirectory: tmpdir(),
    architecture: process.arch,
    fetchImpl: fetch,
    tarCommand: "tar",
  };
}

/** Downloads, checks, extracts, and verifies k6, then returns the binary path. */
export async function installK6(options: K6InstallerOptions = productionOptions()): Promise<string> {
  const manifest = await readManifest(options.manifestPath);
  const architecture = normalizeArchitecture(options.architecture);
  const release = resolveRelease(manifest, architecture);
  const installRoot = await mkdtemp(join(options.temporaryDirectory, "dlt-k6-"));
  const installDir = join(installRoot, manifest.version);
  const binaryPath = join(installDir, "k6");
  const downloadDir = join(installRoot, ".download");
  const archivePath = join(downloadDir, release.archiveName);
  const checksumsPath = join(downloadDir, "checksums.txt");

  try {
    await mkdir(downloadDir);
    // Downloads are intentionally sequential, matching the existing Bash
    // installer and keeping failure cleanup straightforward.
    await download(options.fetchImpl, release.archiveUrl, archivePath, options.waitBeforeRetry);
    await download(options.fetchImpl, release.checksumsUrl, checksumsPath, options.waitBeforeRetry);

    const expectedChecksum = await readExpectedChecksum(checksumsPath, release.archiveName);
    const actualChecksum = createHash("sha256")
      .update(await readFile(archivePath))
      .digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for ${release.archiveName}.`);
    }

    await mkdir(installDir);
    await execFileAsync(
      options.tarCommand,
      ["-xzf", archivePath, "-C", installDir, "--strip-components=1", release.archiveEntry],
      { timeout: TAR_TIMEOUT_MS, killSignal: "SIGKILL" }
    );
    await verifyBinary(binaryPath, manifest.version);
    return binaryPath;
  } catch (error) {
    await rm(installRoot, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
}

/** Reads the k6 release settings and rejects missing or invalid values. */
async function readManifest(manifestPath: string): Promise<K6Manifest> {
  const value = JSON.parse(await readFile(manifestPath, "utf8")) as {
    readonly version?: unknown;
    readonly download?: {
      readonly binary?: unknown;
      readonly checksums?: unknown;
    };
  } | null;
  const version = value?.version;
  const binary = value?.download?.binary;
  const checksums = value?.download?.checksums;
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ||
    typeof binary !== "string" ||
    typeof checksums !== "string"
  ) {
    throw new Error(`Invalid k6 manifest "${manifestPath}".`);
  }

  return { version, download: { binary, checksums } };
}

/** Maps Node's architecture name to the name used by k6 downloads. */
function normalizeArchitecture(architecture: NodeJS.Architecture): "amd64" | "arm64" {
  switch (architecture) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported architecture for k6: ${architecture}`);
  }
}

/** Builds and checks the download details for the requested k6 release. */
function resolveRelease(manifest: K6Manifest, architecture: "amd64" | "arm64") {
  const archiveName = `k6-v${manifest.version}-linux-${architecture}.tar.gz`;
  const checksumsName = `k6-v${manifest.version}-checksums.txt`;
  const archiveUrl = new URL(
    manifest.download.binary.replaceAll("{version}", manifest.version).replaceAll("{arch}", architecture)
  );
  const checksumsUrl = new URL(manifest.download.checksums.replaceAll("{version}", manifest.version));

  if (archiveUrl.protocol !== "https:" || checksumsUrl.protocol !== "https:") {
    throw new Error("k6 downloads must use HTTPS.");
  }
  if (basename(archiveUrl.pathname) !== archiveName || basename(checksumsUrl.pathname) !== checksumsName) {
    throw new Error("k6 manifest download filenames do not match the requested release.");
  }

  return {
    archiveUrl,
    checksumsUrl,
    archiveName,
    archiveEntry: `k6-v${manifest.version}-linux-${architecture}/k6`,
  };
}

/** Downloads the whole file before writing it, so file write errors are not retried. */
async function download(
  fetchImpl: FetchImplementation,
  url: URL,
  destination: string,
  waitBeforeRetry: RetryWaitImplementation = waitWithFullJitter
): Promise<void> {
  const contents = await downloadContents(fetchImpl, url, waitBeforeRetry);
  await writeFile(destination, contents, { flag: "wx" });
}

/** Downloads a file in memory and retries request or response errors up to three times. */
async function downloadContents(
  fetchImpl: FetchImplementation,
  url: URL,
  waitBeforeRetry: RetryWaitImplementation
): Promise<Buffer> {
  let finalError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      finalError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await waitBeforeRetry(RETRY_DELAY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  const message = finalError instanceof Error ? finalError.message : String(finalError);
  throw new Error(`Unable to download ${url.href} after ${DOWNLOAD_ATTEMPTS} attempts: ${message}`, {
    cause: finalError,
  });
}

/** Waits for a random time between zero and the given limit. */
async function waitWithFullJitter(maximumDelayMs: number): Promise<void> {
  await sleep(randomInt(maximumDelayMs));
}

/** Returns the hash from the line whose filename exactly matches the archive. */
async function readExpectedChecksum(checksumsPath: string, archiveName: string): Promise<string> {
  const checksums = await readFile(checksumsPath, "utf8");
  const match = checksums
    .split(/\r?\n/)
    .map(parseChecksumRecord)
    .find((entry) => entry?.filename === archiveName);

  if (match?.digest === undefined) {
    throw new Error(`No checksum found for "${archiveName}".`);
  }
  return match.digest.toLowerCase();
}

/**
 * Splits one checksum line:
 *
 *   [64-character hash] [spaces/tabs] [optional *] [filename]
 *
 * The `*` may appear before the filename for binary files.
 */
function parseChecksumRecord(line: string): { readonly digest: string; readonly filename: string } | undefined {
  const digest = line.slice(0, 64);
  if (!/^[0-9a-fA-F]{64}$/.test(digest)) {
    return undefined;
  }

  let cursor = digest.length;
  if (line[cursor] !== " " && line[cursor] !== "\t") {
    return undefined;
  }
  while (line[cursor] === " " || line[cursor] === "\t") {
    cursor += 1;
  }
  if (line[cursor] === "*") {
    cursor += 1;
  }

  const filename = line.slice(cursor);
  return filename.length > 0 ? { digest, filename } : undefined;
}

/** Checks that the binary is an executable file and reports the expected version. */
async function verifyBinary(binaryPath: string, version: string): Promise<void> {
  const stat = await lstat(binaryPath);
  if (!stat.isFile()) {
    throw new Error(`Installed k6 path is not a regular file: ${binaryPath}`);
  }
  await access(binaryPath, fsConstants.X_OK);

  const { stdout, stderr } = await execFileAsync(binaryPath, ["version"], {
    encoding: "utf8",
    timeout: VERSION_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const output = `${stdout}\n${stderr}`.trim();
  const expectedOutput = `k6 v${version}`;
  if (output !== expectedOutput && !output.startsWith(`${expectedOutput} `)) {
    throw new Error(`Installed k6 reported an unexpected version: ${output || "<empty>"}`);
  }
}
