// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  computePollIntervalSeconds,
  GRACE_PERIOD_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
} from "../src/poll-interval.js";

/** Step Functions hard limit on execution history events. */
const HISTORY_EVENT_LIMIT = 25_000;

/** Events one poll cycle costs: LambdaInvoke (5) + Choice (2) + Wait (2). */
const EVENTS_PER_POLL_CYCLE = 9;

/** Share of the history limit the poll interval is sized against. */
const POLLING_EVENT_BUDGET = 20_000;

const HOUR = 3600;

/** Events the completion loop consumes for a test of the given duration. */
function pollingEventsFor(testDuration: number): number {
  const interval = computePollIntervalSeconds(testDuration);
  const cycles = Math.ceil((testDuration + GRACE_PERIOD_SECONDS) / interval);
  return cycles * EVENTS_PER_POLL_CYCLE;
}

describe("computePollIntervalSeconds", () => {
  describe("clamping", () => {
    it("returns the floor for short tests", () => {
      expect(computePollIntervalSeconds(60)).toBe(MIN_POLL_INTERVAL_SECONDS);
      expect(computePollIntervalSeconds(HOUR)).toBe(MIN_POLL_INTERVAL_SECONDS);
      expect(computePollIntervalSeconds(3 * HOUR)).toBe(MIN_POLL_INTERVAL_SECONDS);
    });

    it("returns the ceiling for very long tests", () => {
      expect(computePollIntervalSeconds(48 * HOUR)).toBe(MAX_POLL_INTERVAL_SECONDS);
      expect(computePollIntervalSeconds(30 * 24 * HOUR)).toBe(MAX_POLL_INTERVAL_SECONDS);
    });

    it("never returns a value outside the clamp range", () => {
      for (let hours = 1; hours <= 72; hours++) {
        const interval = computePollIntervalSeconds(hours * HOUR);
        expect(interval).toBeGreaterThanOrEqual(MIN_POLL_INTERVAL_SECONDS);
        expect(interval).toBeLessThanOrEqual(MAX_POLL_INTERVAL_SECONDS);
      }
    });

    it("returns whole seconds — SecondsPath rejects fractional waits", () => {
      for (let hours = 1; hours <= 48; hours++) {
        expect(Number.isInteger(computePollIntervalSeconds(hours * HOUR))).toBe(true);
      }
    });
  });

  describe("scaling", () => {
    it("increases monotonically with duration", () => {
      let previous = 0;
      for (let hours = 1; hours <= 48; hours++) {
        const interval = computePollIntervalSeconds(hours * HOUR);
        expect(interval).toBeGreaterThanOrEqual(previous);
        previous = interval;
      }
    });

    it("scales past the floor once the budget requires it", () => {
      // The floor covers ~6h; beyond that the formula governs.
      expect(computePollIntervalSeconds(7 * HOUR)).toBeGreaterThan(MIN_POLL_INTERVAL_SECONDS);
      expect(computePollIntervalSeconds(24 * HOUR)).toBeGreaterThan(computePollIntervalSeconds(12 * HOUR));
    });
  });

  describe("event budget", () => {
    it("keeps a 24h test within the polling budget", () => {
      expect(pollingEventsFor(24 * HOUR)).toBeLessThanOrEqual(POLLING_EVENT_BUDGET);
    });

    it("stays within the polling budget for every duration the formula governs", () => {
      // Up to the point where the MAX ceiling binds, the budget must hold.
      for (let hours = 1; hours <= 36; hours++) {
        expect(pollingEventsFor(hours * HOUR)).toBeLessThanOrEqual(POLLING_EVENT_BUDGET);
      }
    });

    it("stays under the hard history limit well past the supported range", () => {
      // Past ~37h the ceiling binds and consumption grows again, but there is
      // still headroom to ~46h before the execution would actually fail.
      expect(pollingEventsFor(46 * HOUR)).toBeLessThan(HISTORY_EVENT_LIMIT);
    });

    it("fixes the regression: 15s polling overflows where the dynamic interval does not", () => {
      // The reported failure — a fixed 15s interval on a long test.
      const duration = 24 * HOUR;
      const fixedIntervalEvents = Math.ceil((duration + GRACE_PERIOD_SECONDS) / 15) * EVENTS_PER_POLL_CYCLE;

      expect(fixedIntervalEvents).toBeGreaterThan(HISTORY_EVENT_LIMIT);
      expect(pollingEventsFor(duration)).toBeLessThanOrEqual(POLLING_EVENT_BUDGET);
    });
  });

  describe("invalid input", () => {
    it("falls back to the floor rather than producing an unusable wait", () => {
      // A zero/negative/NaN duration must not yield 0 (busy loop) or NaN
      // (SecondsPath runtime failure).
      for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(computePollIntervalSeconds(duration)).toBe(MIN_POLL_INTERVAL_SECONDS);
      }
    });
  });
});
