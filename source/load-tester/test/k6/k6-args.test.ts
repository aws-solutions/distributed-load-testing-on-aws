// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { buildK6Args } from "../../src/k6/k6-args.js";

const BASE = {
  scriptPath: "/tmp/work/my test.ts",
  csvOutputPath: "/tmp/artifacts/kpi results.csv",
  jsonOutputPath: "/tmp/artifacts/kpi results.json",
};

describe("buildK6Args", () => {
  it("passes only the script and output flags — the script controls its own load", () => {
    expect(buildK6Args(BASE)).toEqual([
      "run",
      "--no-usage-report",
      "--out",
      "csv=/tmp/artifacts/kpi results.csv",
      "--out",
      "json=/tmp/artifacts/kpi results.json",
      "/tmp/work/my test.ts",
    ]);
  });

  it("passes no load flags", () => {
    const args = buildK6Args(BASE);

    expect(args).not.toContain("--vus");
    expect(args).not.toContain("--duration");
    expect(args).not.toContain("--stage");
  });
});
