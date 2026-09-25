// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stopJMeter } from "../../src/jmeter/shutdown.js";

describe("stopJMeter", () => {
  let jmeterHome: string;
  let markerPath: string;

  beforeEach(async () => {
    jmeterHome = await mkdtemp(join(tmpdir(), "dlt-jmeter-stop-test-"));
    markerPath = join(jmeterHome, "stopped");
    await mkdir(join(jmeterHome, "bin"));
  });

  afterEach(async () => {
    await rm(jmeterHome, { recursive: true, force: true });
  });

  it("runs the shutdown client bundled with the install", async () => {
    await writeStopScript(`#!/bin/sh\necho "$#" > "${markerPath}"\n`);

    await expect(stopJMeter({ jmeterHome })).resolves.toBeUndefined();
    // stoptest.sh defaults to port 4445, so DLT passes no arguments.
    await expect(readFile(markerPath, "utf8")).resolves.toBe("0\n");
  });

  it("reports a shutdown client that fails", async () => {
    await writeStopScript('#!/bin/sh\necho "connection refused" >&2\nexit 1\n');

    await expect(stopJMeter({ jmeterHome })).rejects.toThrow("Unable to stop JMeter");
  });

  it("reports a missing shutdown client", async () => {
    await expect(stopJMeter({ jmeterHome })).rejects.toThrow("Unable to stop JMeter");
  });

  it("gives up on a shutdown client that hangs before the supervisor deadline", async () => {
    await writeStopScript("#!/bin/sh\nsleep 30\n");

    await expect(stopJMeter({ jmeterHome, timeoutMs: 200 })).rejects.toThrow("Unable to stop JMeter");
  });

  async function writeStopScript(contents: string): Promise<void> {
    const scriptPath = join(jmeterHome, "bin", "stoptest.sh");
    await writeFile(scriptPath, contents, { mode: 0o755 });
  }
});
