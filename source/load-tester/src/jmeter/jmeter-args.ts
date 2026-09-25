// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Builds the command line the runner passes to `jmeter`.
//
// Flags we always pass (https://jmeter.apache.org/usermanual/get-started.html#non_gui):
//   -n         non-GUI mode
//   -t <jmx>   the customer's test plan, run unmodified
//   -l <jtl>   the KPI log DLT tails for live data and reduces for results
//   -j <log>   JMeter's own log, kept as a customer artifact
//
// Load overrides are absent here on purpose, and there is no other mechanism
// behind them: the plan is the sole authority on load and DLT never rewrites it.
// JMeter only honours `-J` values in a plan that opted in with `${__P(...)}`
// (https://jmeter.apache.org/usermanual/functions.html#__P), so passing them
// would silently do nothing on a typical JMX — and rewriting the customer's
// thread groups to make them authoritative means interpreting XML whose
// vocabulary grows with every published plug-in, which cannot be done without
// sometimes running a different test than the customer authored.
// `maxTestDurationSeconds` remains DLT's independent safety timeout.
//
// The `-J` properties below pin the JTL's shape. A `-J` value beats both
// jmeter.properties and a customer's user.properties
// (https://jmeter.apache.org/usermanual/get-started.html#override), so pinning
// them is what makes the columns DLT parses a contract rather than a default that
// a bundled properties file could change underneath us. Every property named here
// is listed at https://jmeter.apache.org/usermanual/properties_reference.html

import { join } from "node:path";

/**
 * Columns DLT reads out of the JTL, plus the bulk payload columns we keep off.
 * Response bodies and headers would balloon the file and embed newlines in the
 * CSV for no benefit — DLT never reads them.
 *
 * Column meanings and the CSV header they produce:
 * https://jmeter.apache.org/usermanual/listeners.html#csvlogformat
 */
const SAVE_SERVICE_PROPERTIES: Readonly<Record<string, string>> = {
  output_format: "csv",
  print_field_names: "true",
  default_delimiter: ",",
  timestamp_format: "ms",
  // Without autoflush the JTL is only readable in blocks, which breaks both
  // live-data tailing and reading partial results after an abort.
  autoflush: "true",
  time: "true",
  label: "true",
  response_code: "true",
  response_message: "true",
  thread_name: "true",
  data_type: "true",
  successful: "true",
  assertion_results_failure_message: "true",
  bytes: "true",
  sent_bytes: "true",
  thread_counts: "true",
  url: "true",
  latency: "true",
  idle_time: "true",
  connect_time: "true",
  response_data: "false",
  samplerData: "false",
  responseHeaders: "false",
  requestHeaders: "false",
  // Defaults to true (bin/jmeter.properties). Sub-samples — every hop of a
  // followed redirect, every child of a Transaction Controller that generates a
  // parent — would each land as their own JTL row, and the reducer counts rows
  // equally. Left on, a redirecting plan roughly doubles totalRequestCount and
  // mixes component timings into the aggregate percentiles.
  subresults: "false",
};

const ENGINE_PROPERTIES: Readonly<Record<string, string>> = {
  // JMeter stopped calling System.exit() after a CLI run in 2.5.1, so a plugin
  // that leaves a non-daemon thread behind keeps the JVM alive and stalls the
  // container's finalize phase.
  // https://jmeter.apache.org/usermanual/get-started.html#shutdown
  "jmeterengine.force.system.exit": "true",
  // JMeter walks nongui.port..nongui.maxport looking for a free command port.
  // Pinning both ends keeps it on 4445, the port stoptest.sh talks to.
  // https://jmeter.apache.org/usermanual/build-test-plan.html#stop
  "jmeterengine.nongui.port": "4445",
  "jmeterengine.nongui.maxport": "4445",
};

export interface BuildJMeterArgsInput {
  readonly scriptPath: string;
  readonly kpiJtlPath: string;
  readonly jmeterLogPath: string;
}

export function buildJMeterArgs(input: BuildJMeterArgsInput): string[] {
  return [
    "-n",
    "-t",
    input.scriptPath,
    "-l",
    input.kpiJtlPath,
    "-j",
    input.jmeterLogPath,
    ...Object.entries(SAVE_SERVICE_PROPERTIES).map(([key, value]) => `-Jjmeter.save.saveservice.${key}=${value}`),
    ...Object.entries(ENGINE_PROPERTIES).map(([key, value]) => `-J${key}=${value}`),
  ];
}

/** Paths the runner and the reducer both need to agree on. */
export function jmeterArtifactPaths(artifactsDir: string): { kpiJtlPath: string; jmeterLogPath: string } {
  return {
    kpiJtlPath: join(artifactsDir, "kpi.jtl"),
    jmeterLogPath: join(artifactsDir, "jmeter.log"),
  };
}
