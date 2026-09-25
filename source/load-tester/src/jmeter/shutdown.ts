// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Kill a running JMeter test and flush the JTL logs.
//
// t=0s          The run is cut short — DLT's max-duration timer fired, or ECS
//               sent SIGTERM to stop a cancelled or failed test.
//               superviseProcess starts its deadline and triggers stopJMeter().
//   ├─ 0-10s    stoptest.sh starts a second JVM and sends StopTestNow, then
//   │           JMeter flushes the JTL and exits.
//   ├─ 0-12s    Total grace period, including stoptest.sh. At 12s we forcefully
//   │           kill JMeter if it is still running and lose in-flight requests.
//   └─ 12-120s  Reduce kpi.jtl and upload test artifacts to S3 before the task
//               shuts down.
// t=120s        ECS sends SIGKILL to the container regardless.
//
// https://jmeter.apache.org/usermanual/build-test-plan.html#stop

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const STOP_TIMEOUT_MS = 10_000;

export interface StopJMeterInput {
  readonly jmeterHome: string;
  readonly timeoutMs?: number;
}

/**
 * Asks a still-running JMeter to stop. Returns once the request is delivered, not
 * once JMeter has exited — superviseProcess waits for the exit.
 */
export async function stopJMeter(input: StopJMeterInput): Promise<void> {
  const scriptPath = join(input.jmeterHome, "bin", "stoptest.sh");
  try {
    await execFileAsync(scriptPath, [], {
      timeout: input.timeoutMs ?? STOP_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to stop JMeter with "${scriptPath}": ${message}`, { cause: error });
  }
}
