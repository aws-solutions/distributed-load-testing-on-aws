// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { buildLocustArgs } from "../../src/locust/locust-args.js";

const BASE = {
  scriptPath: "/tmp/work/locustfile.py",
  artifactsDir: "/tmp/artifacts",
  sidecarPath: "/opt/dlt/sidecar.py",
};

describe("buildLocustArgs", () => {
  it("builds the full command line when no overrides are set", () => {
    expect(buildLocustArgs(BASE)).toEqual([
      "-f",
      "/opt/dlt/sidecar.py,/tmp/work/locustfile.py",
      "--headless",
      "--only-summary",
      "--csv=/tmp/artifacts/locust",
      "--json-file=/tmp/artifacts/locust-final",
      "--logfile=/tmp/artifacts/locust.log",
      "--exit-code-on-error=0",
      "--stop-timeout=10",
    ]);
  });

  it("separates the two -f files with a comma, which is what Locust expects", () => {
    const args = buildLocustArgs(BASE);
    const files = args[args.indexOf("-f") + 1];

    expect(files).toBe("/opt/dlt/sidecar.py,/tmp/work/locustfile.py");
  });

  it("passes no load flags when there are no overrides", () => {
    const args = buildLocustArgs(BASE);

    expect(args).not.toContain("--users");
    expect(args).not.toContain("--spawn-rate");
    expect(args).not.toContain("--run-time");
  });

  it("does not pass --csv-full-history, which competes for the upload budget", () => {
    expect(buildLocustArgs(BASE)).not.toContain("--csv-full-history");
  });

  it("writes every artifact into the artifacts directory", () => {
    const args = buildLocustArgs({ ...BASE, artifactsDir: "/var/out" });

    expect(args).toContain("--csv=/var/out/locust");
    expect(args).toContain("--json-file=/var/out/locust-final");
    expect(args).toContain("--logfile=/var/out/locust.log");
  });
});
