// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  CANCELABLE_RUN_STATUSES,
  FRAMEWORKS,
  isActiveRunStatus,
  isCancelableRunStatus,
  isTerminalRunStatus,
  TERMINAL_RUN_STATUSES,
  TEST_TYPE_TO_FRAMEWORK,
  TestStatus,
} from "../src/test-execution.js";

describe("FRAMEWORKS", () => {
  it("contains all supported frameworks", () => {
    expect(FRAMEWORKS).toEqual(new Set(["jmeter", "k6", "locust"]));
  });

  it("has exactly 3 entries", () => {
    expect(FRAMEWORKS.size).toBe(3);
  });
});

describe("TEST_TYPE_TO_FRAMEWORK", () => {
  it("maps simple to locust", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.simple).toBe("locust");
  });

  it("maps jmeter to jmeter", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.jmeter).toBe("jmeter");
  });

  it("maps k6 to k6", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.k6).toBe("k6");
  });

  it("maps locust to locust", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.locust).toBe("locust");
  });

  it("covers all TestType values", () => {
    expect(Object.keys(TEST_TYPE_TO_FRAMEWORK).sort()).toEqual(["jmeter", "k6", "locust", "simple"]);
  });
});

describe("isCancelableRunStatus", () => {
  it("accepts the early/active states where a cancel is meaningful", () => {
    expect(isCancelableRunStatus(TestStatus.QUEUED)).toBe(true);
    expect(isCancelableRunStatus(TestStatus.PROVISIONING)).toBe(true);
    expect(isCancelableRunStatus(TestStatus.RUNNING)).toBe(true);
    // Included so a repeat cancel while cleanup is in progress stays idempotent.
    expect(isCancelableRunStatus(TestStatus.CANCELLING)).toBe(true);
  });

  it("rejects the finishing states to avoid racing the terminal metadata write", () => {
    expect(isCancelableRunStatus(TestStatus.CLEANING_UP)).toBe(false);
    expect(isCancelableRunStatus(TestStatus.PARSING_RESULTS)).toBe(false);
  });

  it("rejects terminal states", () => {
    expect(isCancelableRunStatus(TestStatus.COMPLETE)).toBe(false);
    expect(isCancelableRunStatus(TestStatus.FAILED)).toBe(false);
    expect(isCancelableRunStatus(TestStatus.CANCELLED)).toBe(false);
  });

  it("does not include the finishing states in the set", () => {
    expect(CANCELABLE_RUN_STATUSES.has(TestStatus.CLEANING_UP)).toBe(false);
    expect(CANCELABLE_RUN_STATUSES.has(TestStatus.PARSING_RESULTS)).toBe(false);
  });
});

describe("ACTIVE_RUN_STATUSES / TERMINAL_RUN_STATUSES partition", () => {
  const allStatuses = Object.values(TestStatus);

  it("are disjoint (no status is both active and terminal)", () => {
    const overlap = allStatuses.filter(
      (status) => ACTIVE_RUN_STATUSES.has(status) && TERMINAL_RUN_STATUSES.has(status)
    );
    expect(overlap).toEqual([]);
  });

  it("together cover every TestStatus value (none silently uncategorized)", () => {
    const uncategorized = allStatuses.filter(
      (status) => !ACTIVE_RUN_STATUSES.has(status) && !TERMINAL_RUN_STATUSES.has(status)
    );
    expect(uncategorized).toEqual([]);
  });

  it("classify each TestStatus as exactly one of active or terminal", () => {
    for (const status of allStatuses) {
      // Exactly one of the two guards must be true for every known status. This
      // guarantees a new lifecycle state can't be added without being placed in
      // one set, which would otherwise leave it neither active nor terminal and
      // silently disable every client action for it.
      expect(isActiveRunStatus(status)).toBe(!isTerminalRunStatus(status));
    }
  });
});
