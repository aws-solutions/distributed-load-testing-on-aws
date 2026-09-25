// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Starter templates for `--from-file` specs.
 *
 * `scenarios spec-template` prints one of these so a user can start from a
 * filled-in, valid-shaped example instead of a blank file — the main
 * blank-page friction in setting up a test. The output is an option-shape spec
 * (the same keys `--from-file` consumes), tailored to the test type and mode so
 * only the relevant fields appear.
 */

/** Default script file extension shown per framework. */
const SCRIPT_EXTENSION: Record<string, string> = {
  jmeter: "jmx",
  k6: "js",
  locust: "py",
};

/**
 * Build a starter spec object for the given test type and mode.
 *
 * @param testType One of `simple`, `jmeter`, `k6`, `locust`.
 * @param nativeMode When true (framework types only), emit the native-mode
 *   field (`maxTestDuration`) instead of the standard concurrency/hold-for
 *   fields.
 */
export function buildSpecTemplate(testType: string, nativeMode: boolean): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    testName: "My Test",
    testDescription: "Describe what this test does",
    testType,
  };

  if (testType === "simple") {
    spec["httpEndpoint"] = "https://example.com/api";
    spec["httpMethod"] = "GET";
    spec["headers"] = {};
  } else {
    // jmeter / k6 / locust run a user script.
    spec["file"] = `./path/to/script.${SCRIPT_EXTENSION[testType] ?? "jmx"}`;
  }

  spec["regions"] = ["us-east-1"];
  spec["taskCount"] = 1;

  if (nativeMode && testType !== "simple") {
    // Native mode runs the uploaded script's own load; only the safety timeout
    // is configurable.
    spec["nativeMode"] = true;
    spec["maxTestDuration"] = "30m";
  } else {
    spec["concurrency"] = 10;
    spec["rampUp"] = "1m";
    spec["holdFor"] = "10m";
  }

  spec["tags"] = ["example"];
  spec["healthyThreshold"] = 90;

  // Scheduling (optional). Empty values = Run Now (start immediately on create).
  // Fill EITHER cron for a recurring schedule, OR scheduleDate + scheduleTime
  // for a one-time run ("Run Once"). Leave all empty to run immediately.
  spec["cron"] = "";
  spec["scheduleDate"] = "";
  spec["scheduleTime"] = "";
  spec["scheduleTimezone"] = "UTC";

  return spec;
}
