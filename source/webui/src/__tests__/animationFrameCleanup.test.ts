// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

/**
 * Locks in the animation-frame cleanup installed by setupTests.ts.
 *
 * Without that cleanup, a frame a test schedules and never cancels fires after the test
 * environment has been torn down, and the resulting exception surfaces as
 * `TypeError: Cannot read properties of null (reading '_location')`. Vitest counts it as an
 * unhandled error and fails the whole run even though every test passed, which has failed
 * the solution's build and verification stages intermittently. The cleanup is global setup
 * rather than a per-component fix, so this suite verifies the observable contract instead of
 * any one call site.
 *
 * The cleanup drains outstanding frames rather than discarding them, because a frame can
 * have a compensating timer that only stands down once the frame has run. Redux Toolkit's
 * auto-batcher is one: it schedules a frame alongside a 100 ms setTimeout and lets whichever
 * runs first cancel the other. Discarding its frame left that timer armed to fire after
 * teardown, trading the error above for `ReferenceError: cancelAnimationFrame is not
 * defined`, so the contract below is "ran before the test ended", not "never ran".
 */

/** jsdom drives animation frames from a 60 Hz interval, so one frame is about 16.7 ms. */
const FRAME_INTERVAL_MS = 1000 / 60;

/** Long enough that a surviving frame would have fired several times over. */
const SEVERAL_FRAMES_MS = Math.ceil(FRAME_INTERVAL_MS * 6);

/** The fallback timeout Redux Toolkit pairs with each auto-batch animation frame. */
const FALLBACK_TIMEOUT_MS = 100;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("animation frame cleanup", () => {
  let leakedFrameRuns = 0;
  let schedulerRan = false;
  let endlessFrameRuns = 0;
  let cancellerRuns = 0;
  let victimRuns = 0;
  let victimHandle = 0;

  it("still runs frames that a test waits for", async () => {
    let fired = false;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        fired = true;
        resolve();
      })
    );
    expect(fired).toBe(true);
  });

  it("returns a handle that cancelAnimationFrame honors", async () => {
    let fired = false;
    const handle = requestAnimationFrame(() => {
      fired = true;
    });
    expect(typeof handle).toBe("number");

    cancelAnimationFrame(handle);
    await wait(SEVERAL_FRAMES_MS);
    expect(fired).toBe(false);
  });

  it("schedules a frame and deliberately leaves it outstanding", () => {
    // Deliberately not cancelled. The next test asserts the cleanup drained it.
    requestAnimationFrame(() => {
      leakedFrameRuns += 1;
    });
    expect(leakedFrameRuns).toBe(0);
  });

  it("drains a frame left outstanding by the previous test, exactly once", async () => {
    // Drained during the previous test's cleanup, so it can no longer fire after teardown.
    expect(leakedFrameRuns).toBe(1);

    // And draining consumed it rather than leaving it queued to run again.
    await wait(SEVERAL_FRAMES_MS);
    expect(leakedFrameRuns).toBe(1);
  });

  it("stands down a frame's compensating timer, as Redux Toolkit's auto-batcher needs", () => {
    // Mirrors createRafWithFallbackTimer in @reduxjs/toolkit: a frame and a timer race, and
    // whichever runs first cancels the other. Discarding the frame instead of running it
    // leaves the timer armed to fire after teardown, where the global cancelAnimationFrame
    // it reaches for no longer exists.
    const callback = () => {
      if (schedulerRan) return;
      schedulerRan = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
    };
    const rafId = requestAnimationFrame(callback);
    const timerId = setTimeout(callback, FALLBACK_TIMEOUT_MS);

    expect(schedulerRan).toBe(false);
  });

  it("ran the compensating scheduler before the previous test ended", async () => {
    expect(schedulerRan).toBe(true);

    // Nothing is left armed, so no stray timer can reach for a torn-down global.
    await wait(FALLBACK_TIMEOUT_MS * 1.5);
    expect(schedulerRan).toBe(true);
  });

  it("schedules a frame that endlessly reschedules itself", () => {
    // Draining runs callbacks, so a callback that reschedules could outrun the drain budget.
    // Leaving its frame queued would reintroduce the post-teardown leak, so the cleanup has
    // to cancel whatever it cannot drain.
    const reschedule = () => {
      endlessFrameRuns += 1;
      requestAnimationFrame(reschedule);
    };
    requestAnimationFrame(reschedule);

    expect(endlessFrameRuns).toBe(0);
  });

  it("stopped the endlessly rescheduling frame rather than leaving it queued", async () => {
    const runsAfterCleanup = endlessFrameRuns;
    expect(runsAfterCleanup).toBeGreaterThan(0);

    // Whatever the drain could not finish was cancelled, so nothing runs after the test.
    await wait(SEVERAL_FRAMES_MS);
    expect(endlessFrameRuns).toBe(runsAfterCleanup);
  });

  it("schedules a frame whose callback cancels another outstanding frame", () => {
    // The canceller is scheduled first so it runs first and cancels a frame the drain has
    // not reached yet. A browser would skip the cancelled frame, so draining must too.
    requestAnimationFrame(() => {
      cancellerRuns += 1;
      cancelAnimationFrame(victimHandle);
    });
    victimHandle = requestAnimationFrame(() => {
      victimRuns += 1;
    });

    expect(cancellerRuns).toBe(0);
    expect(victimRuns).toBe(0);
  });

  it("skipped the frame cancelled part way through the drain", async () => {
    expect(cancellerRuns).toBe(1);
    expect(victimRuns).toBe(0);

    // And it was not merely deferred.
    await wait(SEVERAL_FRAMES_MS);
    expect(victimRuns).toBe(0);
  });
});
