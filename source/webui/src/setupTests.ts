// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import "@testing-library/jest-dom";
import { Amplify } from "aws-amplify";
import { afterAll, afterEach, beforeAll } from "vitest";
import { MOCK_SERVER_URL, server } from "./__tests__/server";

// The MSW (Mock Service Worker) can't intercept Amplify API calls with the native fetch. The following statement loads web APIs from undici in order to enable MSW to intercept Amplify API calls.
import { fetch, Headers, Request, Response } from 'undici';

Object.assign(globalThis, {
  fetch,
  Headers,
  Request,
  Response,
});

process.env.TZ = "UTC"; // fix environment timezone for tests to UTC

/**
 * Tracks every outstanding animation frame so it can be cancelled when a test ends.
 *
 * jsdom drives requestAnimationFrame from a 60 Hz setInterval, so a frame a component
 * scheduled and never cancelled keeps running after the test that scheduled it. When it
 * finally fires, the surrounding document is gone, the callback throws, and jsdom reports
 * that exception through `window.location`, whose getter dereferences the nulled document
 * and throws `TypeError: Cannot read properties of null (reading '_location')`. That second
 * error escapes jsdom's own try/catch, so vitest records it as an unhandled error and exits
 * non-zero even when every test passed. It also leaves the 60 Hz interval alive, because
 * jsdom only clears it once no frames remain outstanding.
 *
 * Cancelling whatever is still pending after each test removes the whole class of failure
 * rather than one leaking call site, so a call site added later cannot reintroduce it.
 * React Testing Library registers its own `cleanup` in an `afterEach` when vitest globals
 * are enabled, and vitest runs `afterEach` hooks in reverse registration order, so
 * components have already unmounted by the time this hook drains the queue.
 */
const pendingAnimationFrames = new Map<number, FrameRequestCallback>();
const hasAnimationFrames =
  typeof globalThis.requestAnimationFrame === "function" && typeof globalThis.cancelAnimationFrame === "function";

/** A drained callback may schedule another frame, so allow a few passes before giving up. */
const MAX_DRAIN_PASSES = 10;

if (hasAnimationFrames) {
  const nativeRequestAnimationFrame = globalThis.requestAnimationFrame;
  const nativeCancelAnimationFrame = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const handle = nativeRequestAnimationFrame((time) => {
      // Delete before invoking, so a callback that schedules another frame is tracked
      // under its own handle rather than being dropped with this one.
      pendingAnimationFrames.delete(handle);
      callback(time);
    });
    pendingAnimationFrames.set(handle, callback);
    return handle;
  };

  globalThis.cancelAnimationFrame = (handle: number): void => {
    pendingAnimationFrames.delete(handle);
    nativeCancelAnimationFrame(handle);
  };

  afterEach(() => {
    // Run whatever is still outstanding rather than discarding it. Discarding is not safe:
    // a frame can have a compensating timer that only stands down once the frame has run.
    // Redux Toolkit's auto-batcher is one, scheduling a frame and a 100 ms setTimeout where
    // whichever runs first cancels the other (createRafWithFallbackTimer). Cancelling its
    // frame without running the callback guarantees the timer path runs instead, and when
    // the jsdom environment is torn down inside that window the callback dereferences the
    // by-then undefined global `cancelAnimationFrame`. Vitest records the resulting
    // ReferenceError as an unhandled error and exits non-zero even though every test
    // passed. Draining here, while the document and the globals are still alive, both
    // honours that contract and leaves no frame outstanding for jsdom to run later.
    for (let pass = 0; pendingAnimationFrames.size > 0 && pass < MAX_DRAIN_PASSES; pass += 1) {
      for (const [handle, callback] of [...pendingAnimationFrames]) {
        // Claim the handle, and skip a frame that an earlier callback in this pass already
        // cancelled. A browser would not run a cancelled frame, so neither should draining.
        if (!pendingAnimationFrames.delete(handle)) continue;
        nativeCancelAnimationFrame(handle);
        try {
          callback(performance.now());
        } catch {
          // A frame scheduled by a component that has since unmounted can throw once its
          // target is gone. Draining is housekeeping, so this must not fail the test that
          // happens to be ending.
        }
      }
    }

    // Cancel, do not merely forget, anything a pathological callback kept rescheduling past
    // the drain budget. Forgetting a handle leaves the frame queued in jsdom, which is the
    // leak this hook exists to prevent, so the queue must be empty either way.
    for (const handle of pendingAnimationFrames.keys()) {
      nativeCancelAnimationFrame(handle);
    }
    pendingAnimationFrames.clear();
  });
}

beforeAll(() => {
  // Start MSW server before configuring Amplify
  server.listen({ onUnhandledRequest: "warn" });

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: "",
        userPoolClientId: "",
      },
    },
    API: {
      REST: {
        "solution-api": {
          endpoint: MOCK_SERVER_URL,
        },
      },
    },
  });
});
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
