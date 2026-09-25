// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Installs the Apache JMeter runtime for a native-mode test.
//
// JMeter is deliberately absent from the image. The solution build packages the
// pinned release, its SHA-512, jmeter.json, and every pinned plugin zip into
// jmeter-bundle.tgz (scripts/download-jmeter-bundle.sh), and a deployment-time
// custom resource copies that bundle into the scenarios bucket.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { S3Client } from "@aws-sdk/client-s3";

import { extractZip } from "../archive/extract-zip.js";
import { downloadToFile } from "../s3/download-to-file.js";

/** Where the CopyJMeterBundle custom resource writes the bundle. */
const BUNDLE_KEY = "frameworks/jmeter/jmeter-bundle.tgz";

/** Names the Apache release tar and the directory inside it both start with. */
const RELEASE_PREFIX = "apache-jmeter-";

const TAR_TIMEOUT_MS = 120_000;
const VERSION_TIMEOUT_MS = 60_000;

const execFileAsync = promisify(execFile);

export interface InstallJMeterInput {
  readonly s3: S3Client;
  /** Scenarios bucket. The client must target the hub region where the bucket is deployed. */
  readonly bucket: string;
  /** Directory the install root is created in, e.g. os.tmpdir(). */
  readonly temporaryDirectory: string;
}

/** Installs JMeter from the shipped bundle and returns JMETER_HOME. */
export async function installJMeter(input: InstallJMeterInput): Promise<string> {
  const installRoot = await mkdtemp(join(input.temporaryDirectory, "dlt-jmeter-"));
  const downloadDir = join(installRoot, ".download");
  const bundlePath = join(downloadDir, "jmeter-bundle.tgz");
  // The tar is built with a single `jmeter-bundle/` top-level entry.
  const bundleDir = join(downloadDir, "jmeter-bundle");

  try {
    await mkdir(downloadDir);
    await downloadToFile({ s3: input.s3, bucket: input.bucket, key: BUNDLE_KEY, destPath: bundlePath });
    await untar(bundlePath, downloadDir);

    const release = await findEntry(bundleDir, (entry) => entry.startsWith(RELEASE_PREFIX) && entry.endsWith(".tgz"));
    if (release === undefined) {
      throw new Error(`JMeter bundle does not contain a ${RELEASE_PREFIX}*.tgz release.`);
    }
    const releasePath = join(bundleDir, release);
    await verifyChecksum(releasePath);

    // The release tar already contains an apache-jmeter-<version>/ directory,
    // and its name is where the installed version comes from.
    await untar(releasePath, installRoot);
    const releaseDir = await findEntry(installRoot, (entry) => entry.startsWith(RELEASE_PREFIX));
    if (releaseDir === undefined) {
      throw new Error(`JMeter release tar did not contain a ${RELEASE_PREFIX}* directory.`);
    }
    const jmeterHome = join(installRoot, releaseDir);

    await installPlugins(join(bundleDir, "plugins"), jmeterHome);
    await verifyInstall(jmeterHome, releaseDir.slice(RELEASE_PREFIX.length));
    return jmeterHome;
  } finally {
    // The bundle and the release tar are ~100MB of ephemeral storage that
    // nothing reads again once JMETER_HOME exists. A half-finished install needs
    // no tidying beyond that: throwing here fails prepare(), which exits the
    // process, and ECS throws the task away.
    await rm(downloadDir, { recursive: true, force: true });
  }
}

async function untar(archivePath: string, destination: string): Promise<void> {
  await execFileAsync("tar", ["-xzf", archivePath, "-C", destination], {
    timeout: TAR_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
}

/** Sorted before matching, so a bundle with two candidates resolves the same
 *  way on every task rather than however the filesystem reports it. */
async function findEntry(directory: string, match: (entry: string) => boolean): Promise<string | undefined> {
  const entries = await readdir(directory);
  return entries.sort((a, b) => a.localeCompare(b)).find(match);
}

/**
 * The bundle ships the checksum file Apache publishes alongside the release, so
 * it sits next to the tar under the same name. Both come out of the same S3
 * object, so this catches a bundle that was assembled or extracted wrong, not a
 * substituted one — the build's own `sha512sum -c` against apache.org is that
 * control.
 */
async function verifyChecksum(releasePath: string): Promise<void> {
  const checksumFile = await readFile(`${releasePath}.sha512`, "utf8");
  const expected = /[0-9a-f]{128}/i.exec(checksumFile)?.[0];
  if (expected === undefined) {
    throw new Error(`No SHA-512 checksum found for "${releasePath}".`);
  }

  const actual = createHash("sha512")
    .update(await readFile(releasePath))
    .digest("hex");
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for "${releasePath}".`);
  }
}

/**
 * Installs every plugin zip in the bundle. The zips carry lib/ and lib/ext/
 * paths, so extracting one over JMETER_HOME is the whole installation — JMeter
 * loads lib/ext/*.jar at JVM start, before it parses the test plan.
 *
 * An empty plugins directory means a bundle that was not built by
 * download-jmeter-bundle.sh, which fails the build rather than shipping a
 * partial set. Better to say so here than to fail later as a missing sampler
 * class partway into the customer's test.
 */
async function installPlugins(pluginsDir: string, jmeterHome: string): Promise<void> {
  const entries = await readdir(pluginsDir);
  // Sorted so that a jar two plugins both ship resolves the same way on every
  // task, whatever order the filesystem reports.
  const zips = entries.filter((entry) => entry.endsWith(".zip")).sort((a, b) => a.localeCompare(b));
  if (zips.length === 0) {
    throw new Error(`JMeter bundle contains no plugins in "${pluginsDir}".`);
  }

  for (const zip of zips) {
    try {
      const summary = await extractZip(join(pluginsDir, zip), resolve(jmeterHome));
      // A plugin zip that yields no files installs nothing, and JMeter then fails
      // much later as a missing sampler class partway into the customer's test.
      if (summary.filesWritten === 0) {
        throw new Error(`Plugin zip yielded no files (non-regular entries skipped: ${summary.skippedCount}).`);
      }
    } catch (error) {
      throw new Error(`Unable to install JMeter plugin "${zip}".`, { cause: error });
    }
  }
}

/**
 * `jmeter --version` prints a banner ending in the version and exits 0, so it
 * proves the launcher, the JVM, and the extracted tree all work together —
 * including that the launcher is a file we are allowed to execute.
 */
async function verifyInstall(jmeterHome: string, version: string): Promise<void> {
  const launcherPath = join(jmeterHome, "bin", "jmeter");

  let output: string;
  try {
    const { stdout, stderr } = await execFileAsync(launcherPath, ["--version"], {
      encoding: "utf8",
      timeout: VERSION_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    output = `${stdout}\n${stderr}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to run installed JMeter at "${launcherPath}": ${message}`, { cause: error });
  }

  if (!output.includes(version)) {
    throw new Error(`Installed JMeter did not report version ${version}: ${output.trim() || "<empty>"}`);
  }
}
