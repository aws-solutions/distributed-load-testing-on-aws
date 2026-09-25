// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { buildJMeterArgs, jmeterArtifactPaths } from "../../src/jmeter/jmeter-args.js";

const PATHS = {
  scriptPath: "/tmp/work/test plan.jmx",
  kpiJtlPath: "/tmp/artifacts/kpi.jtl",
  jmeterLogPath: "/tmp/artifacts/jmeter.log",
};

describe("buildJMeterArgs", () => {
  it("runs the plan in non-GUI mode with the DLT output paths", () => {
    const args = buildJMeterArgs(PATHS);

    expect(args.slice(0, 7)).toEqual([
      "-n",
      "-t",
      "/tmp/work/test plan.jmx",
      "-l",
      "/tmp/artifacts/kpi.jtl",
      "-j",
      "/tmp/artifacts/jmeter.log",
    ]);
  });

  it("pins the JTL columns the reducer reads", () => {
    const args = buildJMeterArgs(PATHS);

    expect(args).toEqual(
      expect.arrayContaining([
        "-Jjmeter.save.saveservice.output_format=csv",
        "-Jjmeter.save.saveservice.print_field_names=true",
        "-Jjmeter.save.saveservice.default_delimiter=,",
        "-Jjmeter.save.saveservice.timestamp_format=ms",
        "-Jjmeter.save.saveservice.time=true",
        "-Jjmeter.save.saveservice.label=true",
        "-Jjmeter.save.saveservice.response_code=true",
        "-Jjmeter.save.saveservice.response_message=true",
        "-Jjmeter.save.saveservice.thread_name=true",
        "-Jjmeter.save.saveservice.data_type=true",
        "-Jjmeter.save.saveservice.successful=true",
        "-Jjmeter.save.saveservice.assertion_results_failure_message=true",
        "-Jjmeter.save.saveservice.bytes=true",
        "-Jjmeter.save.saveservice.sent_bytes=true",
        "-Jjmeter.save.saveservice.thread_counts=true",
        "-Jjmeter.save.saveservice.url=true",
        "-Jjmeter.save.saveservice.latency=true",
        "-Jjmeter.save.saveservice.idle_time=true",
        "-Jjmeter.save.saveservice.connect_time=true",
      ])
    );
  });

  it("keeps sub-samples out of the JTL so one request is one row", () => {
    expect(buildJMeterArgs(PATHS)).toContain("-Jjmeter.save.saveservice.subresults=false");
  });

  it("keeps response bodies and headers out of the JTL", () => {
    const args = buildJMeterArgs(PATHS);

    expect(args).toEqual(
      expect.arrayContaining([
        "-Jjmeter.save.saveservice.response_data=false",
        "-Jjmeter.save.saveservice.samplerData=false",
        "-Jjmeter.save.saveservice.responseHeaders=false",
        "-Jjmeter.save.saveservice.requestHeaders=false",
      ])
    );
  });

  it("flushes each sample so the JTL can be tailed and read after an abort", () => {
    expect(buildJMeterArgs(PATHS)).toContain("-Jjmeter.save.saveservice.autoflush=true");
  });

  it("pins the command port stoptest.sh talks to", () => {
    const args = buildJMeterArgs(PATHS);

    expect(args).toContain("-Jjmeterengine.nongui.port=4445");
    expect(args).toContain("-Jjmeterengine.nongui.maxport=4445");
  });

  it("forces the JVM to exit so a plugin thread cannot stall finalization", () => {
    expect(buildJMeterArgs(PATHS)).toContain("-Jjmeterengine.force.system.exit=true");
  });

  it("passes no load properties — the plan is the sole authority on load", () => {
    const args = buildJMeterArgs(PATHS);

    expect(args.filter((arg) => /threads|concurrency|ramp|duration|hold/i.test(arg))).toEqual([]);
  });
});

describe("jmeterArtifactPaths", () => {
  it("names both artifacts inside the artifacts directory", () => {
    expect(jmeterArtifactPaths("/tmp/artifacts")).toEqual({
      kpiJtlPath: "/tmp/artifacts/kpi.jtl",
      jmeterLogPath: "/tmp/artifacts/jmeter.log",
    });
  });
});
