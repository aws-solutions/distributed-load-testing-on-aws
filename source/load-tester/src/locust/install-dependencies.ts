// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Installs the third-party Python packages a user's Locust test declares in a
// requirements.txt at the top level of their zip. Two modes, matching the
// Taurus-mode load-test.sh so the same archive behaves the same way in both:
//
//   packages/ present → offline install from the bundled wheels, no network
//   packages/ absent  → install from PyPI
//
// Both modes install with --target and reach Locust through PYTHONPATH rather
// than installing in place. The container image puts Locust in a root-owned venv
// at /opt/locust, so there is nowhere in place to install to: pip refuses a
// --user install inside a venv (PEP 405 disables the user site directory), and
// installing with the system pip instead lands in ~/.local, which the venv's
// interpreter ignores — a silent no-op. --target is the only option that works
// for an unprivileged user here.
//
// PYTHONPATH precedes the venv's site-packages, so a user pin can shadow
// Locust's own dependencies. The runner sets it on the Locust process alone, so
// the blast radius stops at that process; DLT's own AWS calls go through the
// JavaScript SDK and are unaffected. The distributions installed are logged so a
// shadowing break is diagnosable from CloudWatch without a rerun.

import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Logger } from "../logger.js";

/** Where the container image puts the interpreter that runs Locust. */
const PYTHON_PATH = "/opt/locust/bin/python";

/**
 * Long enough for a cold install of a realistic requirements.txt over the
 * network, short enough to fail well inside the 30 minute ECS stabilization
 * window. Without a bound, a hung PyPI connection consumes the whole window and
 * reports a stabilization timeout instead of a dependency problem.
 */
export const DEFAULT_PIP_TIMEOUT_MS = 180_000;

/** pip resolution output for a large requirements.txt outgrows the 1 MiB default. */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Tail of pip's stderr kept in the thrown message — the useful part is last. */
const STDERR_LINES_KEPT = 20;

const execFileAsync = promisify(execFile);

export interface ExecFileOptions {
  readonly timeout: number;
  readonly killSignal: "SIGKILL";
  readonly encoding: "utf8";
  readonly maxBuffer: number;
}

export type ExecFileImplementation = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export interface InstallLocustDependenciesOptions {
  /** Directory the user's archive was extracted to — where requirements.txt lives. */
  readonly scriptDir: string;
  /** Directory to install into. Created if the install runs. */
  readonly targetDir: string;
  readonly logger: Logger;
  readonly pythonPath?: string;
  readonly execFileImpl?: ExecFileImplementation;
  readonly timeoutMs?: number;
}

/**
 * Installs the test's declared dependencies and returns the directory to put on
 * PYTHONPATH, or undefined when the archive declares none.
 *
 * Throws when pip fails. Callers run this during setup, before the ECS health
 * marker is written, so a failure surfaces as a stabilization failure with a
 * usable log rather than as a test that runs and measures nothing.
 */
export async function installLocustDependencies(
  options: InstallLocustDependenciesOptions
): Promise<string | undefined> {
  const { scriptDir, targetDir, logger } = options;
  const execFileImpl = options.execFileImpl ?? execFileAsync;
  const pythonPath = options.pythonPath ?? PYTHON_PATH;

  const requirementsPath = path.join(scriptDir, "requirements.txt");
  const packagesDir = path.join(scriptDir, "packages");
  const hasRequirements = await isFile(requirementsPath);
  const hasPackages = await isDirectory(packagesDir);

  if (!hasRequirements) {
    if (hasPackages) {
      // Deliberately not an error: the implementation guide documents that
      // packages/ on its own is ignored, and Taurus mode ignores it silently.
      logger.warn(
        { packagesDir },
        "found a packages/ directory but no requirements.txt — no custom dependencies will be installed"
      );
    }
    return undefined;
  }

  await mkdir(targetDir, { recursive: true });

  const args = [
    "-m",
    "pip",
    "install",
    "--no-cache-dir",
    "--disable-pip-version-check",
    ...(hasPackages ? ["--no-index", `--find-links=${packagesDir}`] : []),
    "-r",
    requirementsPath,
    `--target=${targetDir}`,
  ];

  const source = hasPackages ? "bundled-wheels" : "pypi";
  logger.info({ source, requirementsPath, targetDir }, "installing custom Python dependencies");

  try {
    await execFileImpl(pythonPath, args, {
      timeout: options.timeoutMs ?? DEFAULT_PIP_TIMEOUT_MS,
      killSignal: "SIGKILL",
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error: unknown) {
    throw new Error(`Failed to install custom Python dependencies (${source}): ${describeFailure(error)}`, {
      cause: error,
    });
  }

  const distributions = await listInstalledDistributions(targetDir);
  if (distributions.some((name) => name.toLowerCase().startsWith("locust-"))) {
    logger.warn(
      "requirements.txt installed its own copy of Locust, which takes precedence over the version in this image — " +
        "remove it if the test behaves unexpectedly"
    );
  }
  logger.info({ source, distributions }, "custom Python dependencies installed");

  return targetDir;
}

/** Names of the distributions pip left in the target directory, e.g. "requests-2.32.3". */
async function listInstalledDistributions(targetDir: string): Promise<string[]> {
  const suffix = ".dist-info";
  const entries = await readdir(targetDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => entry.name.slice(0, -suffix.length))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Prefers pip's own stderr over the exec wrapper's message, which says only that
 * the command exited non-zero. The two cases where the child was killed rather
 * than exiting are named, since a killed pip writes no usable stderr.
 */
function describeFailure(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const details = error as { readonly code?: unknown; readonly killed?: unknown; readonly stderr?: unknown };
    // Node sets killed: true for a maxBuffer overflow as well as for the timeout
    // kill, so this has to come first or an overflow reports as a timeout.
    if (details.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return `pip produced more than ${MAX_OUTPUT_BYTES / 1024 / 1024} MiB of output`;
    }
    if (details.killed === true) {
      return "pip did not finish before the timeout";
    }
    if (typeof details.stderr === "string" && details.stderr.trim() !== "") {
      return details.stderr.trim().split(/\r?\n/).slice(-STDERR_LINES_KEPT).join("\n");
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** Treats an unreadable path as absent — the archive simply did not supply it. */
async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
