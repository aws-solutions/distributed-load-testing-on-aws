// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import {
  TestStatus,
  ACTIVE_TEST_STATES,
  getPollingInterval,
} from "../pages/scenarios/constants";

/** The exact set of statuses considered "active" for auto-refresh gating. */
const expectedActiveStatuses: ReadonlySet<TestStatus> = new Set([
  TestStatus.QUEUED,
  TestStatus.PROVISIONING,
  TestStatus.RUNNING,
  TestStatus.CANCELLING,
  TestStatus.CLEANING_UP,
  TestStatus.PARSING_RESULTS,
]);

describe("Task Panel Visibility — Property Tests", () => {
  /**
   * Property 4: Auto-refresh activation matches the active state set
   *
   * For any TestStatus value, ACTIVE_TEST_STATES.has(status) returns true
   * iff status is queued, provisioning, running, cancelling, cleaning up,
   * or parsing results.
   *
   * **Validates: Requirements 5.1, 5.2**
   */
  it("Property 4: ACTIVE_TEST_STATES membership matches expected set", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(TestStatus)), (status) => {
        const actual = ACTIVE_TEST_STATES.has(status);
        const expected = expectedActiveStatuses.has(status);

        expect(actual).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5: Polling interval always matches user selection
   *
   * After removal of fast polling, getPollingInterval returns
   * exactly the user-selected interval for all test states.
   *
   * **Validates: Requirements 5.3**
   */
  it("Property 5: polling interval always matches user selection", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(TestStatus)),
        fc.nat({ max: 120_000 }),
        (status, userInterval) => {
          const interval = getPollingInterval(status, userInterval);

          expect(interval).toBe(userInterval);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Task Panel Visibility — Unit Tests", () => {
  it("queued state IS in ACTIVE_TEST_STATES (still active for auto-refresh)", () => {
    expect(ACTIVE_TEST_STATES.has(TestStatus.QUEUED)).toBe(true);
  });

  it("parsing results state IS in ACTIVE_TEST_STATES (still active for auto-refresh)", () => {
    expect(ACTIVE_TEST_STATES.has(TestStatus.PARSING_RESULTS)).toBe(true);
  });
});
