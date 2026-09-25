// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PIP_TIMEOUT_MS,
  installLocustDependencies,
  type ExecFileImplementation,
} from "../../src/locust/install-dependencies.js";
import type { Logger } from "../../src/logger.js";

const PYTHON = "/opt/locust/bin/python";

let scriptDir: string;
let targetDir: string;
let logger: Logger;
let execFileImpl: ReturnType<typeof vi.fn<ExecFileImplementation>>;

/** Fakes a pip run that installs the given distributions into the target dir. */
function pipInstalling(...distributions: readonly string[]): ExecFileImplementation {
  return async (_file, args) => {
    const target = args.find((arg) => arg.startsWith("--target="))?.slice("--target=".length);
    if (target !== undefined) {
      await Promise.all(distributions.map((name) => mkdir(join(target, `${name}.dist-info`), { recursive: true })));
    }
    return { stdout: "", stderr: "" };
  };
}

/** Rejects the way promisified execFile does — the useful detail is on stderr. */
function pipFailing(stderr: string, extra: Record<string, unknown> = {}): ExecFileImplementation {
  return () =>
    Promise.reject(Object.assign(new Error("Command failed: /opt/locust/bin/python -m pip install"), { stderr, ...extra }));
}

async function install(overrides: Partial<Parameters<typeof installLocustDependencies>[0]> = {}) {
  return installLocustDependencies({ scriptDir, targetDir, logger, pythonPath: PYTHON, execFileImpl, ...overrides });
}

describe("installLocustDependencies", () => {
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "dlt-install-deps-test-"));
    scriptDir = join(root, "scripts");
    targetDir = join(scriptDir, ".dlt-dependencies");
    await mkdir(scriptDir);
    await writeFile(join(scriptDir, "locustfile.py"), "# locustfile\n");

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    execFileImpl = vi.fn<ExecFileImplementation>(pipInstalling());
  });

  afterEach(async () => {
    await rm(join(scriptDir, ".."), { recursive: true, force: true });
  });

  describe("when the archive declares no dependencies", () => {
    it("installs nothing and reports no PYTHONPATH entry", async () => {
      await expect(install()).resolves.toBeUndefined();
      expect(execFileImpl).not.toHaveBeenCalled();
    });

    it("warns rather than fails when wheels are bundled without a requirements.txt", async () => {
      await mkdir(join(scriptDir, "packages"));

      await expect(install()).resolves.toBeUndefined();
      expect(execFileImpl).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(vi.mocked(logger.warn).mock.calls[0]?.[1]).toContain("no requirements.txt");
    });
  });

  describe("when the archive declares dependencies", () => {
    beforeEach(async () => {
      await writeFile(join(scriptDir, "requirements.txt"), "requests==2.32.3\n");
    });

    it("installs from PyPI when no wheels are bundled", async () => {
      await expect(install()).resolves.toBe(targetDir);

      const [file, args] = execFileImpl.mock.calls[0] ?? [];
      expect(file).toBe(PYTHON);
      expect(args).toEqual([
        "-m",
        "pip",
        "install",
        "--no-cache-dir",
        "--disable-pip-version-check",
        "-r",
        join(scriptDir, "requirements.txt"),
        `--target=${targetDir}`,
      ]);
    });

    it("installs from the bundled wheels without reaching the network", async () => {
      await mkdir(join(scriptDir, "packages"));

      await expect(install()).resolves.toBe(targetDir);

      const args = execFileImpl.mock.calls[0]?.[1] ?? [];
      expect(args).toContain("--no-index");
      expect(args).toContain(`--find-links=${join(scriptDir, "packages")}`);
    });

    it("installs from PyPI when packages is a file rather than a directory", async () => {
      await writeFile(join(scriptDir, "packages"), "not a directory\n");

      await install();

      expect(execFileImpl.mock.calls[0]?.[1]).not.toContain("--no-index");
    });

    it("installs into a target directory it creates itself", async () => {
      execFileImpl.mockImplementation(async (_file, args) => {
        const target = args.find((arg) => arg.startsWith("--target="))?.slice("--target=".length);
        await mkdir(join(target ?? "", "requests-2.32.3.dist-info"));
        return { stdout: "", stderr: "" };
      });

      await expect(install()).resolves.toBe(targetDir);
    });

    it("bounds how long pip may run so a hung index cannot eat the stabilization window", async () => {
      await install();

      expect(execFileImpl.mock.calls[0]?.[2].timeout).toBe(DEFAULT_PIP_TIMEOUT_MS);
      expect(execFileImpl.mock.calls[0]?.[2].killSignal).toBe("SIGKILL");
    });

    it("logs the distributions it installed so shadowing is diagnosable without a rerun", async () => {
      execFileImpl.mockImplementation(pipInstalling("requests-2.32.3", "urllib3-2.2.2"));

      await install();

      expect(logger.info).toHaveBeenLastCalledWith(
        { source: "pypi", distributions: ["requests-2.32.3", "urllib3-2.2.2"] },
        "custom Python dependencies installed"
      );
    });

    it("warns when the test installs its own Locust over the image's", async () => {
      execFileImpl.mockImplementation(pipInstalling("locust-2.20.0"));

      await install();

      expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toContain("its own copy of Locust");
    });

    it("does not mistake a distribution merely starting with locust for Locust itself", async () => {
      execFileImpl.mockImplementation(pipInstalling("locustfile_helpers-1.0.0"));

      await install();

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("when pip fails", () => {
    beforeEach(async () => {
      await writeFile(join(scriptDir, "requirements.txt"), "definitely-not-a-real-package\n");
    });

    it("surfaces pip's own explanation rather than the exit status", async () => {
      execFileImpl.mockImplementation(
        pipFailing(
          "Looking in indexes: https://pypi.org/simple\n" +
            "ERROR: Could not find a version that satisfies the requirement definitely-not-a-real-package\n" +
            "ERROR: No matching distribution found for definitely-not-a-real-package"
        )
      );

      await expect(install()).rejects.toThrow(/No matching distribution found for definitely-not-a-real-package/);
    });

    it("names the install source so offline failures are distinguishable", async () => {
      await mkdir(join(scriptDir, "packages"));
      execFileImpl.mockImplementation(pipFailing("ERROR: No matching distribution found for requests"));

      await expect(install()).rejects.toThrow(/\(bundled-wheels\)/);
    });

    it("reports a timeout as a timeout, since a killed pip writes no explanation", async () => {
      execFileImpl.mockImplementation(pipFailing("", { killed: true }));

      await expect(install()).rejects.toThrow(/did not finish before the timeout/);
    });

    it("reports an output overflow as an overflow, not as the timeout it shares killed:true with", async () => {
      execFileImpl.mockImplementation(pipFailing("", { killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));

      await expect(install()).rejects.toThrow(/produced more than 10 MiB of output/);
    });

    it("falls back to the error message when pip produced no stderr", async () => {
      execFileImpl.mockImplementation(() => Promise.reject(new Error("spawn /opt/locust/bin/python ENOENT")));

      await expect(install()).rejects.toThrow(/spawn \/opt\/locust\/bin\/python ENOENT/);
    });

    it("keeps the original failure as the cause", async () => {
      const failure = Object.assign(new Error("Command failed"), { stderr: "ERROR: boom" });
      execFileImpl.mockImplementation(() => Promise.reject(failure));

      await expect(install()).rejects.toMatchObject({ cause: failure });
    });
  });
});
