// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Builds the command line the runner passes to `locust`.
//
// -f takes a comma-separated list of files, which Locust loads together. Both the
// sidecar and the user's script go there. A space instead of the comma silently
// drops the second file, so the separator matters.
//
// Flags we always pass:
//   --headless             no web UI — there's no browser in a container
//   --only-summary         stops Locust printing a stats table every 10s, which would
//                          interleave with the sidecar's JSON lines on stdout
//   --csv                  Locust's own CSVs, kept as debug artifacts
//   --json-file            end-of-test summary, also just an artifact
//   --logfile              sends Python logging to a file so stdout stays parseable
//   --exit-code-on-error   keeps request and task errors from failing the process
//   --stop-timeout         on SIGTERM, wait this long for in-flight requests to finish
//
// DLT passes no load flags: the customer's script is the sole authority on the
// load it generates.

/**
 * Seconds Locust waits for in-flight requests after being told to stop. The
 * runner's grace period must stay above this or we SIGKILL Locust while it is
 * still shutting down cleanly.
 *
 * The goal is to preserve adequate time for the ECS task to take final Locust
 * results and upload to S3 before the task receives SIGKILL.
 */
export const STOP_TIMEOUT_SECONDS = 10;

export interface BuildLocustArgsInput {
  readonly scriptPath: string;
  readonly artifactsDir: string;
  readonly sidecarPath: string;
}

export function buildLocustArgs(input: BuildLocustArgsInput): string[] {
  const { scriptPath, artifactsDir, sidecarPath } = input;

  return [
    "-f",
    `${sidecarPath},${scriptPath}`,
    "--headless",
    "--only-summary",
    `--csv=${artifactsDir}/locust`,
    `--json-file=${artifactsDir}/locust-final`, // Locust appends ".json"
    `--logfile=${artifactsDir}/locust.log`,
    "--exit-code-on-error=0",
    `--stop-timeout=${STOP_TIMEOUT_SECONDS}`,
  ];
}
