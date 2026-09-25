// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Builds the command line the runner passes to `k6`.
//
// Flags we always pass:
//   run                 executes the customer's script without wrapping it
//   --no-usage-report   stops k6 sending its anonymous usage report
//   --out csv=...       raw metrics kept as a customer artifact
//   --out json=...      raw NDJSON used for DLT live data and final results
//
// Both output files preserve every metric k6 emits, including protocols DLT
// does not reduce today. We deliberately leave `systemTags` alone so the
// command behaves like the equivalent local k6 run.
//
// DLT passes no load flags: the customer's script is the sole authority on the
// load it generates.

export interface BuildK6ArgsInput {
  readonly scriptPath: string;
  readonly csvOutputPath: string;
  readonly jsonOutputPath: string;
}

export function buildK6Args(input: BuildK6ArgsInput): string[] {
  const args = [
    "run",
    "--no-usage-report",
    "--out",
    `csv=${input.csvOutputPath}`,
    "--out",
    `json=${input.jsonOutputPath}`,
  ];

  // Keep the path as one argv entry so spaces are not interpreted by a shell.
  args.push(input.scriptPath);
  return args;
}
