// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Poll cycles budgeted per execution — 80% of the 25,000-event history limit at
 * 9 events a cycle.
 *
 * The loop runs in its own distributed-map child execution, where the only other
 * states are the start command and two Pass states, so the polling loop has the
 * budget almost to itself.
 */
const MAX_POLL_CYCLES = 2222;

/** Floor for the poll interval, in seconds. Bounds how stale reported state can be. */
export const MIN_POLL_INTERVAL_SECONDS = 10;

/** Ceiling for the poll interval, in seconds. Bounds detection lag once a test finishes. */
export const MAX_POLL_INTERVAL_SECONDS = 60;

/**
 * Grace period in seconds added to `testDuration` before declaring timeout.
 *
 * Allows time for tasks to upload results and write completion markers after
 * the test itself finishes.
 */
export const GRACE_PERIOD_SECONDS = 300;

/**
 * Computes the completion-poll interval for a test of the given duration.
 *
 * Each poll cycle (Wait → Lambda → Choice) costs Step Functions execution
 * history events, and an execution is capped at 25,000 — so a fixed interval
 * also caps the longest test that can finish. Instead, spread
 * {@link MAX_POLL_CYCLES} polls across the whole window the loop must cover and
 * clamp the result.
 *
 * @param testDuration total test duration in seconds
 * @returns whole seconds to wait between polls
 */
export function computePollIntervalSeconds(testDuration: number): number {
  // Absent or garbage input falls back to the floor rather than 0 or NaN,
  // either of which would break the Wait state.
  if (!Number.isFinite(testDuration) || testDuration <= 0) {
    return MIN_POLL_INTERVAL_SECONDS;
  }

  const interval = Math.ceil((testDuration + GRACE_PERIOD_SECONDS) / MAX_POLL_CYCLES);

  return Math.min(Math.max(interval, MIN_POLL_INTERVAL_SECONDS), MAX_POLL_INTERVAL_SECONDS);
}
